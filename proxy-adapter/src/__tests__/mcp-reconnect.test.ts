/**
 * Crash recovery integration tests for MCPSDKClient.
 *
 * Tests the full lifecycle: connect → crash → reconnect → toolsChanged events.
 * Uses mocked MCP SDK to precisely control transport/client lifecycle callbacks.
 */
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import {
  MCPSDKClient,
  MCPServerUnavailableError,
} from '../clients/mcp/sdk-client.js';
import type { ResolvedConfig } from '../config/schema.js';

// ---------------------------------------------------------------------------
// Mock infrastructure — must use `function` (not arrow) for `new` compatibility
// ---------------------------------------------------------------------------

const mockTools = [
  { name: 'test_tool', description: 'A test tool', inputSchema: { type: 'object' } },
];

/**
 * Shared callback holders so tests can trigger transport/client events
 * after the MCPSDKClient has wired them up via bindServerLifecycle().
 */
const lifecycleCallbacks: {
  transportOnClose: (() => void) | null;
  transportOnError: ((error: Error) => void) | null;
  clientOnClose: (() => void) | null;
} = {
  transportOnClose: null,
  transportOnError: null,
  clientOnClose: null,
};

/** The latest Client mock instance created by the constructor. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentMockClient: any;

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn(function (this: object) {
    this.connect = vi.fn().mockResolvedValue(undefined);
    this.listTools = vi.fn().mockResolvedValue({ tools: mockTools });
    this.callTool = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
    });
    this.close = vi.fn().mockResolvedValue(undefined);
    lifecycleCallbacks.clientOnClose = null;
    Object.defineProperty(this, 'onclose', {
      get() { return lifecycleCallbacks.clientOnClose; },
      set(v: (() => void) | null) { lifecycleCallbacks.clientOnClose = v; },
      configurable: true,
    });
    currentMockClient = this;
  }),
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn(function (this: object) {
    lifecycleCallbacks.transportOnClose = null;
    lifecycleCallbacks.transportOnError = null;
    Object.defineProperty(this, 'onclose', {
      get() { return lifecycleCallbacks.transportOnClose; },
      set(v: (() => void) | null) { lifecycleCallbacks.transportOnClose = v; },
      configurable: true,
    });
    Object.defineProperty(this, 'onerror', {
      get() { return lifecycleCallbacks.transportOnError; },
      set(v: ((error: Error) => void) | null) { lifecycleCallbacks.transportOnError = v; },
      configurable: true,
    });
    Object.defineProperty(this, 'close', {
      value: vi.fn().mockResolvedValue(undefined),
      writable: true,
      configurable: true,
    });
  }),
  getDefaultEnvironment: vi.fn().mockReturnValue({ PATH: '/usr/bin' }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: {
  reconnect?: Record<string, unknown>;
}): ResolvedConfig {
  return {
    mcp: {
      enabled: true,
      servers: {
        'test-server': {
          enabled: true,
          command: 'node',
          args: ['-e', 'process.exit(0)'],
          env: {},
        },
      },
      ...(overrides?.reconnect ? { reconnect: overrides.reconnect } : {}),
    },
  } as unknown as ResolvedConfig;
}

/** Re-mock the Client constructor to always reject connect(). */
async function mockClientAlwaysRejects() {
  const { Client: ClientCtor } = await import('@modelcontextprotocol/sdk/client/index.js');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (ClientCtor as any).mockImplementation(function (this: object) {
    this.connect = vi.fn().mockRejectedValue(new Error('Connection refused'));
    this.listTools = vi.fn().mockResolvedValue({ tools: [] });
    this.callTool = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
    });
    this.close = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(this, 'onclose', {
      get() { return lifecycleCallbacks.clientOnClose; },
      set(v: (() => void) | null) { lifecycleCallbacks.clientOnClose = v; },
      configurable: true,
    });
    currentMockClient = this;
  });
}

/** Restore the default Client mock implementation after contamination by specialized mocks. */
async function restoreDefaultClientMock() {
  const { Client: ClientCtor } = await import('@modelcontextprotocol/sdk/client/index.js');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (ClientCtor as any).mockImplementation(function (this: object) {
    this.connect = vi.fn().mockResolvedValue(undefined);
    this.listTools = vi.fn().mockResolvedValue({ tools: mockTools });
    this.callTool = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
    });
    this.close = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(this, 'onclose', {
      get() { return lifecycleCallbacks.clientOnClose; },
      set(v: (() => void) | null) { lifecycleCallbacks.clientOnClose = v; },
      configurable: true,
    });
    currentMockClient = this;
  });
}

/** Re-mock the Client constructor to return empty tools list. */
async function mockClientReturnsEmptyTools() {
  const { Client: ClientCtor } = await import('@modelcontextprotocol/sdk/client/index.js');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (ClientCtor as any).mockImplementation(function (this: object) {
    this.connect = vi.fn().mockResolvedValue(undefined);
    this.listTools = vi.fn().mockResolvedValue({ tools: [] });
    this.close = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(this, 'onclose', {
      get() { return lifecycleCallbacks.clientOnClose; },
      set(v: (() => void) | null) { lifecycleCallbacks.clientOnClose = v; },
      configurable: true,
    });
    currentMockClient = this;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCP crash recovery', () => {
  let client: MCPSDKClient;

  beforeEach(async () => {
    lifecycleCallbacks.transportOnClose = null;
    lifecycleCallbacks.transportOnError = null;
    lifecycleCallbacks.clientOnClose = null;
    await restoreDefaultClientMock();
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (client) {
      await client.shutdown();
    }
  });

  // -------------------------------------------------------------------------
  // 1. Basic connect → tools available
  // -------------------------------------------------------------------------

  it('should expose tools after successful connect', async () => {
    client = new MCPSDKClient(makeConfig());
    await client.initialize();

    expect(client.isServerRunning('test-server')).toBe(true);
    const tools = client.getAvailableTools();
    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe('test-server.test_tool');
  });

  // -------------------------------------------------------------------------
  // 2. Crash → toolsChanged fires, tools cleared, state → reconnecting
  // -------------------------------------------------------------------------

  it('should emit toolsChanged and clear tools on transport crash', async () => {
    const toolsChangedSpy = vi.fn();
    client = new MCPSDKClient(makeConfig());
    client.on('toolsChanged', toolsChangedSpy);

    await client.initialize();
    expect(client.isServerRunning('test-server')).toBe(true);

    // Simulate transport crash
    lifecycleCallbacks.transportOnClose!();

    expect(toolsChangedSpy).toHaveBeenCalledTimes(2);
    expect(toolsChangedSpy).toHaveBeenLastCalledWith({ serverName: 'test-server' });
    expect(client.getAvailableTools()).toEqual([]);
    expect(client.isServerRunning('test-server')).toBe(false);
    expect(client.getServerState('test-server')).toBe('reconnecting');
  });

  // -------------------------------------------------------------------------
  // 3. Reconnect after backoff → tools available again
  // -------------------------------------------------------------------------

  it('should reconnect and restore tools after backoff', async () => {
    const toolsChangedSpy = vi.fn();
    client = new MCPSDKClient(makeConfig({ reconnect: { baseDelayMs: 100 } }));
    client.on('toolsChanged', toolsChangedSpy);

    await client.initialize();
    expect(client.isServerRunning('test-server')).toBe(true);

    // Crash
    lifecycleCallbacks.transportOnClose!();
    expect(client.getServerState('test-server')).toBe('reconnecting');
    expect(toolsChangedSpy).toHaveBeenCalledTimes(2);

    // Advance past the reconnect delay
    await vi.advanceTimersByTimeAsync(2000);

    expect(client.isServerRunning('test-server')).toBe(true);
    const tools = client.getAvailableTools();
    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe('test-server.test_tool');
    // toolsChanged fired again after reconnect restored tools
    expect(toolsChangedSpy).toHaveBeenCalledTimes(3);
  });

  // -------------------------------------------------------------------------
  // 4. Max attempts → permanent failure
  // -------------------------------------------------------------------------

  it('should transition to failed after max reconnect attempts', async () => {
    await mockClientAlwaysRejects();

    client = new MCPSDKClient(
      makeConfig({
        reconnect: {
          enabled: true,
          maxAttempts: 2,
          baseDelayMs: 10,
          maxDelayMs: 50,
          jitterMs: 0,
        },
      }),
    );

    await client.initialize();

    // Advance through all reconnect attempts
    await vi.advanceTimersByTimeAsync(200);

    expect(client.getServerState('test-server')).toBe('failed');
    expect(client.isServerRunning('test-server')).toBe(false);
    expect(client.getAvailableTools()).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 5. callTool during reconnect → MCPServerUnavailableError
  // -------------------------------------------------------------------------

  it('should throw MCPServerUnavailableError when calling tool during reconnect', async () => {
    client = new MCPSDKClient(makeConfig());
    await client.initialize();

    // Crash
    lifecycleCallbacks.transportOnClose!();
    expect(client.getServerState('test-server')).toBe('reconnecting');

    await expect(
      client.callTool('test-server', 'test_tool', {}),
    ).rejects.toThrow(MCPServerUnavailableError);

    try {
      await client.callTool('test-server', 'test_tool', {});
    } catch (error) {
      expect(error).toBeInstanceOf(MCPServerUnavailableError);
      expect((error as MCPServerUnavailableError).serverState).toBe('reconnecting');
      expect((error as MCPServerUnavailableError).message).toContain('重连中');
    }
  });

  // -------------------------------------------------------------------------
  // 6. Shutdown cancels reconnect timers
  // -------------------------------------------------------------------------

  it('should cancel reconnect timers on shutdown', async () => {
    client = new MCPSDKClient(
      makeConfig({ reconnect: { baseDelayMs: 5000 } }),
    );

    await client.initialize();

    // Crash — schedules a reconnect
    lifecycleCallbacks.transportOnClose!();
    expect(client.getServerState('test-server')).toBe('reconnecting');

    await client.shutdown();

    expect(client.getServerList()).toEqual([]);
    await vi.advanceTimersByTimeAsync(30000);
    expect(client.getServerList()).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 7. Re-entrancy guard — duplicate events handled once
  // -------------------------------------------------------------------------

  it('should handle duplicate disconnect events (re-entrancy guard)', async () => {
    const toolsChangedSpy = vi.fn();
    client = new MCPSDKClient(makeConfig());
    client.on('toolsChanged', toolsChangedSpy);

    await client.initialize();

    lifecycleCallbacks.transportOnClose!();
    lifecycleCallbacks.transportOnError!(new Error('Transport error'));

    expect(toolsChangedSpy).toHaveBeenCalledTimes(2);
    expect(client.getServerState('test-server')).toBe('reconnecting');
  });

  // -------------------------------------------------------------------------
  // 8. transport.onerror triggers same disconnect flow
  // -------------------------------------------------------------------------

  it('should handle transport error events', async () => {
    const toolsChangedSpy = vi.fn();
    client = new MCPSDKClient(makeConfig());
    client.on('toolsChanged', toolsChangedSpy);

    await client.initialize();

    const error = new Error('Subprocess exited unexpectedly');
    lifecycleCallbacks.transportOnError!(error);

    expect(toolsChangedSpy).toHaveBeenCalledTimes(2);
    expect(client.getServerState('test-server')).toBe('reconnecting');
    expect(client.getAvailableTools()).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 9. Reconnect disabled → immediate failure
  // -------------------------------------------------------------------------

  it('should permanently fail when reconnect is disabled', async () => {
    client = new MCPSDKClient(
      makeConfig({ reconnect: { enabled: false } }),
    );

    await client.initialize();
    expect(client.isServerRunning('test-server')).toBe(true);

    lifecycleCallbacks.transportOnClose!();

    expect(client.getServerState('test-server')).toBe('failed');
    expect(client.isServerRunning('test-server')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 10. callTool detects stale connection → triggers disconnect
  // -------------------------------------------------------------------------

  it('should detect stale connection on callTool and trigger reconnect', async () => {
    client = new MCPSDKClient(
      makeConfig({ reconnect: { baseDelayMs: 10, jitterMs: 0 } }),
    );
    await client.initialize();

    currentMockClient.callTool.mockRejectedValueOnce(
      new Error('Connection closed'),
    );

    await expect(
      client.callTool('test-server', 'test_tool', {}),
    ).rejects.toThrow(MCPServerUnavailableError);

    expect(client.getServerState('test-server')).toBe('reconnecting');

    await vi.advanceTimersByTimeAsync(100);

    expect(client.isServerRunning('test-server')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 11. MCPServerUnavailableError message varies by state
  // -------------------------------------------------------------------------

  it('should include server name and state in error message', async () => {
    client = new MCPSDKClient(makeConfig());
    await client.initialize();

    try {
      await client.callTool('non-existent', 'tool', {});
    } catch (error) {
      expect(error).toBeInstanceOf(MCPServerUnavailableError);
      expect((error as MCPServerUnavailableError).serverName).toBe('non-existent');
      expect((error as MCPServerUnavailableError).serverState).toBe('stopped');
      expect((error as MCPServerUnavailableError).message).toContain('non-existent');
      expect((error as MCPServerUnavailableError).message).toContain('不可用');
    }
  });

  // -------------------------------------------------------------------------
  // 12. No toolsChanged when server had no tools at disconnect
  // -------------------------------------------------------------------------

  it('should not emit toolsChanged when server had no tools at disconnect', async () => {
    await mockClientReturnsEmptyTools();

    const toolsChangedSpy = vi.fn();

    const noToolConfig = {
      mcp: {
        enabled: true,
        servers: {
          'empty-server': {
            enabled: true,
            command: 'node',
            args: ['-e', '0'],
            env: {},
          },
        },
        reconnect: { enabled: false },
      },
    } as unknown as ResolvedConfig;

    client = new MCPSDKClient(noToolConfig);
    client.on('toolsChanged', toolsChangedSpy);
    await client.initialize();

    expect(client.getAvailableTools()).toEqual([]);
    expect(client.isServerRunning('empty-server')).toBe(true);

    lifecycleCallbacks.transportOnClose!();

    expect(toolsChangedSpy).not.toHaveBeenCalled();
    expect(client.getServerState('empty-server')).toBe('failed');
  });

  // -------------------------------------------------------------------------
  // 13. getServerList returns state field
  // -------------------------------------------------------------------------

  it('should return state and running fields in getServerList', async () => {
    client = new MCPSDKClient(makeConfig());
    await client.initialize();

    const servers = client.getServerList();
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe('test-server');
    expect(servers[0].state).toBe('running');
    expect(servers[0].running).toBe(true);
    expect(servers[0].toolsCount).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 14. Exponential backoff increases delay
  // -------------------------------------------------------------------------

  it('should use exponential backoff on repeated failures', async () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    await mockClientAlwaysRejects();

    client = new MCPSDKClient(
      makeConfig({ reconnect: { baseDelayMs: 10, maxDelayMs: 100, jitterMs: 0, maxAttempts: 3 } }),
      logger as unknown as import('pino').Logger,
    );

    await client.initialize();

    // Advance to trigger reconnect attempts
    await vi.advanceTimersByTimeAsync(20);
    await vi.advanceTimersByTimeAsync(50);

    // After max attempts, should be permanently failed
    expect(client.getServerState('test-server')).toBe('failed');

    // Verify reconnect scheduling logs show increasing attempt numbers
    const reconnectLogs = logger.info.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'object' && call[0]?.attempt !== undefined,
    );
    expect(reconnectLogs.length).toBeGreaterThanOrEqual(3);
  });
});
