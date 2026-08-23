import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { VisionSnapshotLoader } from './snapshot-loader.js';

function fixture() {
  const image = Buffer.from('image-bytes');
  const snapshot = {
    snapshot_id: 'snapshot-1',
    version: '2.0',
    annotated_screenshot_base64: gzipSync(image).toString('base64'),
    elements_map: { one: { id: 'one' } },
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
    domArtifact: { artifactId: 'artifact-1', sha256: hash, mimeType: 'application/json', sizeBytes: bytes.byteLength },
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
    artifacts: [{ id: binding.domArtifact.artifactId, kind: 'dom_snapshot', sha256: hash, mimeType: 'application/json' }],
  };
  return { image, bytes, binding, operation };
}

describe('VisionSnapshotLoader', () => {
  it('checks operation identity and bytes before saving through the DSH attachment seam', async () => {
    const { image, bytes, binding, operation } = fixture();
    const saveImage = vi.fn(async () => ({ attachmentId: 'sha256:image', mediaType: 'image/png', bytes: image.length, width: 1, height: 1 }));
    const readImage = vi.fn(async (ref) => ({ ref, data: image }));
    const loader = new VisionSnapshotLoader({
      gatewayUrl: 'http://127.0.0.1:3000/mcp',
      mcpClient: { callTool: vi.fn(async () => ({ parsed: operation })) },
      attachments: { saveImage, readImage } as never,
      fetch: vi.fn(async () => new Response(bytes, {
        headers: { 'content-type': 'application/json', etag: `"${binding.domArtifact.sha256}"` },
      })) as typeof fetch,
    });
    const loaded = await loader.load(binding);
    expect(saveImage).toHaveBeenCalledWith({ data: image, mediaType: 'image/png', name: 'snapshot-1.png' });
    expect(loaded.snapshot.annotated_screenshot_base64).toBe(image.toString('base64'));
  });

  it('rejects tampered artifact bytes before attachment persistence', async () => {
    const { binding, operation } = fixture();
    const saveImage = vi.fn();
    const loader = new VisionSnapshotLoader({
      gatewayUrl: 'http://127.0.0.1:3000',
      mcpClient: { callTool: vi.fn(async () => ({ parsed: operation })) },
      attachments: { saveImage } as never,
      fetch: vi.fn(async () => new Response('tampered', { headers: { 'content-type': 'application/json' } })) as typeof fetch,
    });
    await expect(loader.load(binding)).rejects.toThrow(/size|hash/u);
    expect(saveImage).not.toHaveBeenCalled();
  });
});
