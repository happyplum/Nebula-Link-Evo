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
    if (!response.ok) throw new Error(`Vision artifact download failed with HTTP ${response.status}`);
    const declaredType = response.headers.get('content-type')?.split(';', 1)[0]?.trim();
    if (declaredType !== binding.domArtifact.mimeType) {
      throw new Error('Vision artifact MIME type does not match its binding');
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength !== binding.domArtifact.sizeBytes || bytes.byteLength > MAX_DOM_ARTIFACT_BYTES) {
      throw new Error('Vision artifact size does not match its binding or exceeds the limit');
    }
    if (sha256(bytes) !== binding.domArtifact.sha256) {
      throw new Error('Vision artifact content hash does not match its binding');
    }
    const etag = response.headers.get('etag')?.replace(/^W\//u, '').replaceAll('"', '');
    if (etag && etag !== binding.domArtifact.sha256) {
      throw new Error('Vision artifact ETag does not match its binding');
    }

    const snapshot = JSON.parse(bytes.toString('utf8')) as DOMSnapshotResponse;
    if (
      !snapshot ||
      snapshot.snapshot_id !== binding.snapshotId ||
      !snapshot.elements_map ||
      typeof snapshot.annotated_screenshot_base64 !== 'string'
    ) {
      throw new Error('Vision DOM artifact does not match the requested snapshot');
    }
    const image = gunzipSync(Buffer.from(snapshot.annotated_screenshot_base64, 'base64'));
    const attachment = await this.options.attachments.saveImage({
      data: image,
      mediaType: 'image/png',
      name: `${binding.snapshotId}.png`,
    });
    const stored = await this.options.attachments.readImage(attachment, signal);
    return {
      snapshot: { ...snapshot, annotated_screenshot_base64: Buffer.from(stored.data).toString('base64') },
      attachment: stored.ref,
    };
  }
}

function parseBinding(value: unknown): VisionSnapshotBindingV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('VisionSnapshotBindingV1 must be an object');
  }
  const binding = value as Partial<VisionSnapshotBindingV1>;
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

function validateOperation(operation: BrowserOperationRecord, binding: VisionSnapshotBindingV1): void {
  const artifact = operation.artifacts.find((item) => item.id === binding.domArtifact.artifactId);
  if (
    operation.operationId !== binding.operationId ||
    operation.requestHash !== binding.requestHash ||
    operation.sessionId !== binding.sessionId ||
    operation.tabId !== binding.tabId ||
    operation.leaseId !== binding.leaseId ||
    operation.leaseSequence !== binding.leaseSequence ||
    operation.status !== binding.status ||
    !artifact ||
    artifact.kind !== 'dom_snapshot' ||
    artifact.sha256 !== binding.domArtifact.sha256 ||
    artifact.mimeType !== binding.domArtifact.mimeType
  ) {
    throw new Error('Vision snapshot binding does not match the durable proxy operation');
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
