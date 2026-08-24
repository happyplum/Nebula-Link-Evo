import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { VisionSnapshotLoader } from './snapshot-loader.js';

function fixture() {
  const image = Buffer.from([0xff, 0xd8, 0x00, 0xff, 0xd9]);
  const snapshot = {
    snapshot_id: 'snapshot-1',
    version: '2.0',
    annotated_screenshot_base64: gzipSync(image).toString('base64'),
    elements_map: {
      one: {
        id: 'one',
        tag: 'button',
        bbox: { x: 0, y: 0, width: 1, height: 1 },
        locator_bundle: { css: 'button' },
      },
    },
    simplified_dom: { elements: [], viewport: { width: 1, height: 1 } },
  };
  const bytes = Buffer.from(JSON.stringify(snapshot));
  const hash = createHash('sha256').update(bytes).digest('hex');
  const binding = {
    schema: 'nebula.vision-snapshot-binding/1.0',
    sessionId: 'browser-session',
    tabId: 'tab-1',
    operationId: 'operation-1',
    requestHash: 'request-hash',
    leaseId: 'lease-1',
    leaseSequence: 3,
    snapshotId: 'snapshot-1',
    status: 'succeeded',
    domArtifact: {
      artifactId: 'artifact-1',
      sha256: hash,
      mimeType: 'application/json',
      sizeBytes: bytes.byteLength,
    },
  } as const;
  const operation = {
    schema: 'nebula.browser.operation-result/1.0',
    operationId: binding.operationId,
    requestHash: binding.requestHash,
    sessionId: binding.sessionId,
    leaseId: binding.leaseId,
    leaseSequence: binding.leaseSequence,
    tabId: binding.tabId,
    kind: 'observe',
    operation: 'dom_snapshot',
    status: 'succeeded',
    queueSequence: 1,
    acceptedAt: new Date().toISOString(),
    artifacts: [
      {
        id: binding.domArtifact.artifactId,
        kind: 'dom_snapshot',
        sha256: hash,
        mimeType: 'application/json',
      },
    ],
  };
  return { image, bytes, binding, operation };
}

function buildLoader(
  binding: ReturnType<typeof fixture>['binding'],
  operation: ReturnType<typeof fixture>['operation'],
  bytes: Buffer
) {
  const saveImage = vi.fn(async () => ({
    attachmentId: 'sha256:image',
    mediaType: 'image/jpeg',
    bytes: 5,
    width: 1,
    height: 1,
  }));
  const readImage = vi.fn(async (ref) => ({
    ref,
    data: Buffer.from([0xff, 0xd8, 0x00, 0xff, 0xd9]),
  }));
  const fetchImpl = vi.fn(
    async () =>
      new Response(bytes, {
        headers: { 'content-type': 'application/json', etag: `"${binding.domArtifact.sha256}"` },
      })
  ) as typeof fetch;
  return {
    loader: new VisionSnapshotLoader({
      gatewayUrl: 'http://127.0.0.1:3000',
      mcpClient: { callTool: vi.fn(async () => ({ parsed: operation })) },
      attachments: { saveImage, readImage } as never,
      fetch: fetchImpl,
    }),
    fetchImpl,
    saveImage,
  };
}

describe('VisionSnapshotLoader', () => {
  it('checks operation identity and bytes before saving through the DSH attachment seam', async () => {
    const { image, bytes, binding, operation } = fixture();
    const saveImage = vi.fn(async () => ({
      attachmentId: 'sha256:image',
      mediaType: 'image/png',
      bytes: image.length,
      width: 1,
      height: 1,
    }));
    const readImage = vi.fn(async (ref) => ({ ref, data: image }));
    const loader = new VisionSnapshotLoader({
      gatewayUrl: 'http://127.0.0.1:3000/mcp',
      mcpClient: { callTool: vi.fn(async () => ({ parsed: operation })) },
      attachments: { saveImage, readImage } as never,
      fetch: vi.fn(
        async () =>
          new Response(bytes, {
            headers: {
              'content-type': 'application/json',
              etag: `"${binding.domArtifact.sha256}"`,
            },
          })
      ) as typeof fetch,
    });
    const loaded = await loader.load(binding);
    expect(saveImage).toHaveBeenCalledWith({
      data: image,
      mediaType: 'image/jpeg',
      name: 'snapshot-1.jpg',
    });
    expect(loaded.snapshot.annotated_screenshot_base64).toBe(image.toString('base64'));
  });

  it('rejects tampered artifact bytes before attachment persistence', async () => {
    const { binding, operation } = fixture();
    const saveImage = vi.fn();
    const loader = new VisionSnapshotLoader({
      gatewayUrl: 'http://127.0.0.1:3000',
      mcpClient: { callTool: vi.fn(async () => ({ parsed: operation })) },
      attachments: { saveImage } as never,
      fetch: vi.fn(
        async () => new Response('tampered', { headers: { 'content-type': 'application/json' } })
      ) as typeof fetch,
    });
    await expect(loader.load(binding)).rejects.toThrow(/size|hash/u);
    expect(saveImage).not.toHaveBeenCalled();
  });

  it.each([
    [
      'session',
      (operation: Record<string, unknown>) => {
        operation.sessionId = 'other-session';
      },
    ],
    [
      'tab',
      (operation: Record<string, unknown>) => {
        operation.tabId = 'other-tab';
      },
    ],
    [
      'operation',
      (operation: Record<string, unknown>) => {
        operation.operationId = 'other-operation';
      },
    ],
    [
      'request hash',
      (operation: Record<string, unknown>) => {
        operation.requestHash = 'other-hash';
      },
    ],
    [
      'lease',
      (operation: Record<string, unknown>) => {
        operation.leaseId = 'other-lease';
      },
    ],
    [
      'lease sequence',
      (operation: Record<string, unknown>) => {
        operation.leaseSequence = 4;
      },
    ],
    [
      'status',
      (operation: Record<string, unknown>) => {
        operation.status = 'failed';
      },
    ],
    [
      'kind',
      (operation: Record<string, unknown>) => {
        operation.kind = 'act';
      },
    ],
  ])('rejects %s drift before downloading the artifact', async (_name, mutate) => {
    const { binding, operation, bytes } = fixture();
    mutate(operation as unknown as Record<string, unknown>);
    const { loader, fetchImpl } = buildLoader(binding, operation, bytes);
    await expect(loader.load(binding)).rejects.toThrow(/does not match/u);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects binding schema drift and unknown fields before querying proxy', async () => {
    const { binding, operation, bytes } = fixture();
    const { loader, fetchImpl } = buildLoader(binding, operation, bytes);
    await expect(loader.load({ ...binding, extra: true })).rejects.toThrow(/unknown fields/u);
    await expect(loader.load({ ...binding, status: 'failed' })).rejects.toThrow(/invalid/u);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [
      'snapshot version',
      (snapshot: Record<string, unknown>) => {
        snapshot.version = '1.0';
      },
    ],
    [
      'snapshot id',
      (snapshot: Record<string, unknown>) => {
        snapshot.snapshot_id = 'other';
      },
    ],
    [
      'element identity',
      (snapshot: Record<string, unknown>) => {
        (snapshot.elements_map as Record<string, { id: string }>).one.id = 'other';
      },
    ],
    [
      'base64',
      (snapshot: Record<string, unknown>) => {
        snapshot.annotated_screenshot_base64 = '%%%=';
      },
    ],
  ])('rejects invalid %s before attachment persistence', async (_name, mutate) => {
    const base = fixture();
    const snapshot = JSON.parse(base.bytes.toString('utf8')) as Record<string, unknown>;
    mutate(snapshot);
    const bytes = Buffer.from(JSON.stringify(snapshot));
    const hash = createHash('sha256').update(bytes).digest('hex');
    const binding = {
      ...base.binding,
      domArtifact: { ...base.binding.domArtifact, sha256: hash, sizeBytes: bytes.byteLength },
    };
    const operation = {
      ...base.operation,
      artifacts: [{ ...base.operation.artifacts[0], sha256: hash }],
    };
    const { loader, saveImage } = buildLoader(binding, operation, bytes);
    await expect(loader.load(binding)).rejects.toThrow();
    expect(saveImage).not.toHaveBeenCalled();
  });

  it('rejects MIME mismatch and unsupported decompressed image bytes', async () => {
    const base = fixture();
    const wrongMimeFetch = vi.fn(
      async () =>
        new Response(base.bytes, {
          headers: { 'content-type': 'text/plain' },
        })
    ) as typeof fetch;
    const loader = new VisionSnapshotLoader({
      gatewayUrl: 'http://127.0.0.1:3000',
      mcpClient: { callTool: vi.fn(async () => ({ parsed: base.operation })) },
      attachments: {} as never,
      fetch: wrongMimeFetch,
    });
    await expect(loader.load(base.binding)).rejects.toThrow(/MIME/u);

    const snapshot = JSON.parse(base.bytes.toString('utf8')) as Record<string, unknown>;
    snapshot.annotated_screenshot_base64 = gzipSync(Buffer.from('not-image')).toString('base64');
    const bytes = Buffer.from(JSON.stringify(snapshot));
    const hash = createHash('sha256').update(bytes).digest('hex');
    const binding = {
      ...base.binding,
      domArtifact: { ...base.binding.domArtifact, sha256: hash, sizeBytes: bytes.length },
    };
    const operation = {
      ...base.operation,
      artifacts: [{ ...base.operation.artifacts[0], sha256: hash }],
    };
    const { loader: invalidImageLoader } = buildLoader(binding, operation, bytes);
    await expect(invalidImageLoader.load(binding)).rejects.toThrow(/unsupported image/u);
  });
});
