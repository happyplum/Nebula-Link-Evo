import { describe, expect, it, vi } from 'vitest';
import {
  ACT_OPERATIONS,
  OBSERVE_OPERATIONS,
} from '@nebula-link-evo/shared/types/browser-execution';
import {
  requireProxyBrowserCapabilities,
  requireProxyMcpTools,
  type ProxyCapabilitiesFetcher,
} from './proxy-capabilities.js';
import { publicMcpToolName } from '../harness/runtime.js';

const validCapabilities = {
  schema: 'nebula.service-capabilities/1.0',
  service: 'proxy-adapter',
  serviceVersion: '1.0.0',
  protocols: {
    browserExecution: { major: 1, minor: 0 },
    browserOperation: { major: 1, minor: 0 },
  },
  features: {
    persistentOperationLedger: true,
    visibleBrowser: true,
    liveView: true,
    operationCaptureArtifacts: true,
    browserSessionEvents: true,
    artifactDownload: true,
    localControlPlane: true,
    observeLeaseSingleUse: true,
    supportedObservations: OBSERVE_OPERATIONS.join(','),
    supportedActions: ACT_OPERATIONS.join(','),
  },
  limits: {
    maxActiveBrowserSessions: 1,
    maxBrowserContextsPerSession: 1,
    maxControlLeasesPerSession: 1,
  },
  generatedAt: '2026-08-24T00:00:00.000Z',
};

function fetcher(payload: unknown = validCapabilities, status = 200): ProxyCapabilitiesFetcher {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }));
}

describe('requireProxyBrowserCapabilities', () => {
  it('accepts the public browser execution contract and normalizes an MCP URL', async () => {
    const request = fetcher();
    await expect(
      requireProxyBrowserCapabilities('http://127.0.0.1:3000/mcp', { fetcher: request })
    ).resolves.toMatchObject({ service: 'proxy-adapter' });
    expect(request).toHaveBeenCalledWith('http://127.0.0.1:3000/api/v1/capabilities', {
      signal: expect.any(AbortSignal),
      headers: { accept: 'application/json' },
    });
  });

  it.each([
    ['wrong service', { ...validCapabilities, service: 'other' }],
    [
      'wrong protocol major',
      {
        ...validCapabilities,
        protocols: { ...validCapabilities.protocols, browserOperation: { major: 2, minor: 0 } },
      },
    ],
    [
      'disabled local control plane',
      {
        ...validCapabilities,
        features: { ...validCapabilities.features, localControlPlane: false },
      },
    ],
    [
      'missing operation',
      { ...validCapabilities, features: { ...validCapabilities.features, supportedActions: '' } },
    ],
    [
      'multiple browser contexts',
      {
        ...validCapabilities,
        limits: { ...validCapabilities.limits, maxBrowserContextsPerSession: 2 },
      },
    ],
  ])('rejects %s without fallback', async (_name, payload) => {
    await expect(
      requireProxyBrowserCapabilities('http://127.0.0.1:3000', { fetcher: fetcher(payload) })
    ).rejects.toThrow('proxy-adapter capabilities are incompatible');
  });

  it('rejects discovery transport failures', async () => {
    const request: ProxyCapabilitiesFetcher = vi.fn(async () => {
      throw new Error('connection refused');
    });
    await expect(
      requireProxyBrowserCapabilities('http://127.0.0.1:3000', { fetcher: request })
    ).rejects.toThrow('capability discovery failed: connection refused');
  });

  it('rejects non-loopback gateway URLs before discovery', async () => {
    const request = fetcher();
    await expect(
      requireProxyBrowserCapabilities('https://proxy.example.com', { fetcher: request })
    ).rejects.toThrow('loopback-only');
    expect(request).not.toHaveBeenCalled();
  });
});

describe('requireProxyMcpTools', () => {
  const required = [
    'browser-control.operation_execute',
    'browser-control.operation_get',
    'browser-control.operation_cancel',
  ].map((toolName) => publicMcpToolName('gateway', toolName));

  it('accepts the isolated raw operation transport surface', () => {
    expect(() => requireProxyMcpTools(required)).not.toThrow();
  });

  it('rejects an incomplete MCP discovery result', () => {
    expect(() => requireProxyMcpTools(required.slice(0, 2))).toThrow(
      'proxy-adapter MCP tools are unavailable'
    );
  });
});
