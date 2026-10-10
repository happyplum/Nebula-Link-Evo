import {
  ACT_OPERATIONS,
  OBSERVE_OPERATIONS,
  type BrowserExecutionCapabilities,
} from '@nebula-link-evo/shared/types/browser-execution';
import { publicMcpToolName } from '../harness/runtime.js';

const REQUIRED_BOOLEAN_FEATURES = [
  'persistentOperationLedger',
  'visibleBrowser',
  'liveView',
  'operationCaptureArtifacts',
  'browserSessionEvents',
  'artifactDownload',
  'localControlPlane',
  'observeLeaseSingleUse',
] as const;

export interface ProxyCapabilitiesFetcher {
  (
    input: string,
    init: { signal: AbortSignal; headers: Record<string, string> }
  ): Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
  }>;
}

export async function requireProxyBrowserCapabilities(
  gatewayUrl: string,
  options: { fetcher?: ProxyCapabilitiesFetcher; timeoutMs?: number } = {}
): Promise<BrowserExecutionCapabilities> {
  const endpoint = capabilityEndpoint(gatewayUrl);
  const fetcher = options.fetcher ?? fetch;
  let response: Awaited<ReturnType<ProxyCapabilitiesFetcher>>;
  try {
    response = await fetcher(endpoint, {
      signal: AbortSignal.timeout(options.timeoutMs ?? 5_000),
      headers: { accept: 'application/json' },
    });
  } catch (error) {
    throw new Error(`proxy-adapter capability discovery failed: ${errorMessage(error)}`, {
      cause: error,
    });
  }
  if (!response.ok) {
    throw new Error(`proxy-adapter capability discovery returned HTTP ${response.status}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error(`proxy-adapter capability response is not valid JSON: ${errorMessage(error)}`, {
      cause: error,
    });
  }
  assertCapabilities(payload);
  return payload;
}

export function requireProxyMcpTools(discoveredToolNames: readonly string[]): void {
  const discovered = new Set(discoveredToolNames);
  const missing = [
    'browser-control.operation_execute',
    'browser-control.operation_get',
    'browser-control.operation_cancel',
  ]
    .map((toolName) => publicMcpToolName('gateway', toolName))
    .filter((toolName) => !discovered.has(toolName));
  if (missing.length > 0) {
    throw new Error(`proxy-adapter MCP tools are unavailable: ${missing.join(', ')}`);
  }
}

function capabilityEndpoint(gatewayUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(gatewayUrl);
  } catch {
    throw new Error('proxy-adapter gateway URL is invalid');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('proxy-adapter gateway URL must use HTTP or HTTPS');
  }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) {
    throw new Error('proxy-adapter gateway URL must be loopback-only');
  }
  parsed.pathname = parsed.pathname.replace(/\/$/u, '').replace(/\/mcp$/u, '');
  parsed.pathname = `${parsed.pathname}/api/v1/capabilities`.replace(/\/{2,}/gu, '/');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

function assertCapabilities(value: unknown): asserts value is BrowserExecutionCapabilities {
  if (!isRecord(value)) fail('response must be an object');
  if (value.schema !== 'nebula.service-capabilities/1.0')
    fail('schema must be nebula.service-capabilities/1.0');
  if (value.service !== 'proxy-adapter') fail('service must be proxy-adapter');
  if (typeof value.serviceVersion !== 'string' || value.serviceVersion.length === 0)
    fail('serviceVersion is required');
  if (!isRecord(value.protocols)) fail('protocols must be an object');
  requireProtocol(value.protocols, 'browserExecution');
  requireProtocol(value.protocols, 'browserOperation');
  if (!isRecord(value.features)) fail('features must be an object');
  for (const feature of REQUIRED_BOOLEAN_FEATURES) {
    if (value.features[feature] !== true) fail(`feature ${feature} must be true`);
  }
  requireOperations(value.features, 'supportedObservations', OBSERVE_OPERATIONS);
  requireOperations(value.features, 'supportedActions', ACT_OPERATIONS);
  if (!isRecord(value.limits)) fail('limits must be an object');
  requireLimit(value.limits, 'maxActiveBrowserSessions', 1);
  requireLimit(value.limits, 'maxBrowserContextsPerSession', 1);
  requireLimit(value.limits, 'maxControlLeasesPerSession', 1);
  if (typeof value.generatedAt !== 'string' || Number.isNaN(Date.parse(value.generatedAt)))
    fail('generatedAt must be an ISO date-time');
}

function requireProtocol(protocols: Record<string, unknown>, name: string): void {
  const protocol = protocols[name];
  if (!isRecord(protocol) || protocol.major !== 1 || !Number.isInteger(protocol.minor)) {
    fail(`protocol ${name} major 1 is required`);
  }
}

function requireOperations(
  features: Record<string, unknown>,
  name: string,
  required: readonly string[]
): void {
  const raw = features[name];
  if (typeof raw !== 'string') fail(`feature ${name} must be a comma-separated string`);
  const advertised = new Set(
    raw
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
  const missing = required.filter((operation) => !advertised.has(operation));
  if (missing.length > 0) fail(`feature ${name} is missing: ${missing.join(', ')}`);
}

function requireLimit(limits: Record<string, unknown>, name: string, expected: number): void {
  if (limits[name] !== expected) fail(`limit ${name} must equal ${expected}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new Error(`proxy-adapter capabilities are incompatible: ${message}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
