import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import type { AttachmentStore, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
import type {
  BrowserOperationRecord,
  DOMSnapshotResponse,
  VisionSnapshotBindingV1,
} from '@nebula-link-evo/shared';
import type { HarnessMcpCaller } from '../harness/types.js';
import { GATEWAY_MCP_SERVER_NAME } from '../config/service-config.js';

const MAX_DOM_ARTIFACT_BYTES = 16 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export interface LoadedVisionSnapshot {
  snapshot: DOMSnapshotResponse;
  attachment: ImageAttachmentRef;
}

export interface VisionSnapshotLoaderOptions {
  gatewayUrl: string;
  mcpClient: HarnessMcpCaller;
  attachments: AttachmentStore;
  fetch?: typeof fetch;
}

/** Verifies proxy operation metadata and artifact bytes before admitting an image. */
export class VisionSnapshotLoader {
  private readonly fetchImpl: typeof fetch;
  private readonly gatewayUrl: string;

  constructor(private readonly options: VisionSnapshotLoaderOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.gatewayUrl = options.gatewayUrl.replace(/\/$/u, '').replace(/\/mcp$/u, '');
  }

  async load(raw: unknown, signal?: AbortSignal): Promise<LoadedVisionSnapshot> {
    const binding = parseBinding(raw);
    const operation = extractOperation(
      await this.options.mcpClient.callTool(
        GATEWAY_MCP_SERVER_NAME,
        'browser-control.operation_get',
        { operationId: binding.operationId },
        signal ? { signal } : {}
      )
    );
    validateOperation(operation, binding);

    const url = `${this.gatewayUrl}/api/v1/browser-execution/sessions/${encodeURIComponent(binding.sessionId)}/artifacts/${encodeURIComponent(binding.domArtifact.artifactId)}`;
    const response = await this.fetchImpl(url, { signal, redirect: 'error' });
    if (!response.ok)
      throw new Error(`Vision artifact download failed with HTTP ${response.status}`);
    const declaredType = response.headers.get('content-type')?.split(';', 1)[0]?.trim();
    if (declaredType !== binding.domArtifact.mimeType) {
      throw new Error('Vision artifact MIME type does not match its binding');
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (
      bytes.byteLength !== binding.domArtifact.sizeBytes ||
      bytes.byteLength > MAX_DOM_ARTIFACT_BYTES
    ) {
      throw new Error('Vision artifact size does not match its binding or exceeds the limit');
    }
    if (sha256(bytes) !== binding.domArtifact.sha256) {
      throw new Error('Vision artifact content hash does not match its binding');
    }
    const etag = response.headers.get('etag')?.replace(/^W\//u, '').replaceAll('"', '');
    if (etag && etag !== binding.domArtifact.sha256) {
      throw new Error('Vision artifact ETag does not match its binding');
    }

    const snapshot = parseSnapshot(bytes, binding.snapshotId);
    const compressedImage = decodeBase64(snapshot.annotated_screenshot_base64);
    const image = gunzipSync(compressedImage, {
      maxOutputLength: MAX_IMAGE_BYTES,
    });
    const mediaType = detectImageMediaType(image);
    const attachment = await this.options.attachments.saveImage({
      data: image,
      mediaType,
      name: `${binding.snapshotId}.${mediaType === 'image/png' ? 'png' : 'jpg'}`,
    });
    const stored = await this.options.attachments.readImage(attachment, signal);
    return {
      snapshot: {
        ...snapshot,
        annotated_screenshot_base64: Buffer.from(stored.data).toString('base64'),
      },
      attachment: stored.ref,
    };
  }
}

function parseSnapshot(bytes: Buffer, snapshotId: string): DOMSnapshotResponse {
  const value: unknown = JSON.parse(bytes.toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Vision DOM artifact is not an object');
  }
  const snapshot = value as Partial<DOMSnapshotResponse>;
  if (
    snapshot.snapshot_id !== snapshotId ||
    snapshot.version !== '2.0' ||
    !snapshot.elements_map ||
    typeof snapshot.elements_map !== 'object' ||
    Array.isArray(snapshot.elements_map) ||
    typeof snapshot.annotated_screenshot_base64 !== 'string' ||
    !snapshot.simplified_dom ||
    typeof snapshot.simplified_dom !== 'object'
  ) {
    throw new Error('Vision DOM artifact does not match the v2 snapshot contract');
  }
  for (const [id, element] of Object.entries(snapshot.elements_map)) {
    if (
      !element ||
      typeof element !== 'object' ||
      element.id !== id ||
      typeof element.tag !== 'string' ||
      !element.locator_bundle ||
      typeof element.locator_bundle !== 'object' ||
      !element.bbox ||
      ![element.bbox.x, element.bbox.y, element.bbox.width, element.bbox.height].every(
        (coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate)
      )
    ) {
      throw new Error('Vision DOM artifact contains an invalid element map');
    }
  }
  return snapshot as DOMSnapshotResponse;
}

function decodeBase64(value: string): Buffer {
  if (
    !value ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
  ) {
    throw new Error('Vision snapshot screenshot is not canonical base64');
  }
  return Buffer.from(value, 'base64');
}

function parseBinding(value: unknown): VisionSnapshotBindingV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('VisionSnapshotBindingV1 must be an object');
  }
  const binding = value as Partial<VisionSnapshotBindingV1>;
  assertExactKeys(value as Record<string, unknown>, [
    'schema',
    'sessionId',
    'tabId',
    'operationId',
    'requestHash',
    'leaseId',
    'leaseSequence',
    'snapshotId',
    'status',
    'domArtifact',
  ]);
  if (binding.domArtifact && typeof binding.domArtifact === 'object') {
    assertExactKeys(binding.domArtifact as unknown as Record<string, unknown>, [
      'artifactId',
      'sha256',
      'mimeType',
      'sizeBytes',
    ]);
  }
  if (
    binding.schema !== 'nebula.vision-snapshot-binding/1.0' ||
    binding.status !== 'succeeded' ||
    !binding.sessionId ||
    !binding.tabId ||
    !binding.operationId ||
    !binding.requestHash ||
    !binding.leaseId ||
    !Number.isSafeInteger(binding.leaseSequence) ||
    !binding.snapshotId ||
    !binding.domArtifact ||
    binding.domArtifact.mimeType !== 'application/json' ||
    !/^[a-f0-9]{64}$/u.test(binding.domArtifact.sha256) ||
    !Number.isSafeInteger(binding.domArtifact.sizeBytes) ||
    binding.domArtifact.sizeBytes < 1 ||
    !binding.domArtifact.artifactId
  ) {
    throw new Error('VisionSnapshotBindingV1 is invalid');
  }
  return binding as VisionSnapshotBindingV1;
}

function validateOperation(
  operation: BrowserOperationRecord,
  binding: VisionSnapshotBindingV1
): void {
  const artifact = Array.isArray(operation.artifacts)
    ? operation.artifacts.find((item) => item.id === binding.domArtifact.artifactId)
    : undefined;
  if (
    operation.schema !== 'nebula.browser.operation-result/1.0' ||
    operation.operationId !== binding.operationId ||
    operation.requestHash !== binding.requestHash ||
    operation.sessionId !== binding.sessionId ||
    operation.tabId !== binding.tabId ||
    operation.leaseId !== binding.leaseId ||
    operation.leaseSequence !== binding.leaseSequence ||
    operation.status !== binding.status ||
    operation.kind !== 'observe' ||
    operation.operation !== 'dom_snapshot' ||
    !artifact ||
    artifact.kind !== 'dom_snapshot' ||
    artifact.sha256 !== binding.domArtifact.sha256 ||
    artifact.mimeType !== binding.domArtifact.mimeType
  ) {
    throw new Error('Vision snapshot binding does not match the durable proxy operation');
  }
}

function detectImageMediaType(bytes: Buffer): 'image/png' | 'image/jpeg' {
  const png =
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (png) return 'image/png';
  const jpeg =
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes.at(-2) === 0xff &&
    bytes.at(-1) === 0xd9;
  if (jpeg) return 'image/jpeg';
  throw new Error('Vision snapshot contains an unsupported image payload');
}

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new Error('VisionSnapshotBindingV1 contains unknown fields');
  }
}

function extractOperation(value: unknown): BrowserOperationRecord {
  if (!value || typeof value !== 'object') throw new Error('Proxy returned no operation record');
  const record = value as Record<string, unknown>;
  if (record.parsed && typeof record.parsed === 'object') {
    return record.parsed as BrowserOperationRecord;
  }
  if (record.structuredContent && typeof record.structuredContent === 'object') {
    return record.structuredContent as BrowserOperationRecord;
  }
  if (typeof record.text === 'string') return JSON.parse(record.text) as BrowserOperationRecord;
  if (Array.isArray(record.content)) {
    const text = record.content
      .filter(
        (item): item is { type: 'text'; text: string } =>
          Boolean(item) &&
          typeof item === 'object' &&
          (item as { type?: unknown }).type === 'text' &&
          typeof (item as { text?: unknown }).text === 'string'
      )
      .map((item) => item.text)
      .join('\n');
    if (text) return JSON.parse(text) as BrowserOperationRecord;
  }
  return record as unknown as BrowserOperationRecord;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
