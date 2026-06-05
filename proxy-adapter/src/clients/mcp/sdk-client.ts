import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type {
  Resource,
  ReadResourceResult,
  Prompt,
  GetPromptResult,
} from '@modelcontextprotocol/sdk/types.js';
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { ResolvedConfig, MCPServerConfig } from '../../config/schema.js';
import { createWorkerLogger } from '../../services/logger.js';
import type { Logger } from 'pino';
import { ProviderError } from '../../services/provider/errors.js';
import { EventEmitter } from 'node:events';

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: object;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

/** Text content block returned by MCP tool calls. */
interface MCPTextContent {
  type: 'text';
  text: string;
}

/** SDK-level return type of client.callTool(). */
type SDKCallToolResult = Awaited<ReturnType<Client['callTool']>>;

/** Structured result when a tool call returns text content. */
interface MCPToolCallTextResult {
  raw: SDKCallToolResult;
  text: string;
  parsed: unknown;
}

// ---------------------------------------------------------------------------
// State machine & runtime types
// ---------------------------------------------------------------------------

type MCPServerState =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'reconnecting'
  | 'failed'
  | 'shutting_down';

interface MCPReconnectPolicy {
  enabled: boolean;
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterMs: number;
}

const DEFAULT_RECONNECT_POLICY: MCPReconnectPolicy = {
  enabled: true,
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitterMs: 500,
};

interface MCPServerRuntime {
  name: string;
  config: MCPServerConfig;
  state: MCPServerState;

  client?: Client;
  transport?: StdioClientTransport;
  tools: MCPTool[];

  reconnectAttempts: number;
  reconnectTimer?: NodeJS.Timeout;

  disconnectHandled: boolean;
  lastError?: Error;
  lastExitReason?: string;
  lastStartedAt?: number;
}

// ---------------------------------------------------------------------------
// Custom error
// ---------------------------------------------------------------------------

export class MCPServerUnavailableError extends Error {
  readonly serverName: string;
  readonly serverState: string;

  constructor(serverName: string, state: string, cause?: Error) {
    const msg =
      state === 'reconnecting'
        ? `MCP server "${serverName}" 正在重连中，请稍后重试。`
        : `MCP server "${serverName}" 不可用（状态: ${state}）。`;
    super(msg, cause);
    this.name = 'MCPServerUnavailableError';
    this.serverName = serverName;
    this.serverState = state;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isConnectionClosedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message?.toLowerCase() ?? '';
  return (
    msg.includes('connection closed') ||
    msg.includes('disconnected') ||
    msg.includes('transport') ||
    msg.includes('eof') ||
    msg.includes('pipe')
  );
}

// ---------------------------------------------------------------------------
// MCPSDKClient
// ---------------------------------------------------------------------------

export class MCPSDKClient extends EventEmitter {
  private config: ResolvedConfig;
  private servers: Map<string, MCPServerRuntime> = new Map();
  private enabled: boolean = false;
  private isShuttingDown: boolean = false;
  private reconnectPolicy: MCPReconnectPolicy;
  private logger: Logger;

  constructor(config: ResolvedConfig, logger?: Logger) {
    super();
    this.config = config;
    this.enabled = config.mcp?.enabled ?? false;
    this.reconnectPolicy = {
      ...DEFAULT_RECONNECT_POLICY,
      ...config.mcp?.reconnect,
    };
    this.logger = logger ?? createWorkerLogger('mcp-sdk-client');
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  async initialize(): Promise<void> {
    if (!this.enabled) {
      this.logger.info('MCP is disabled');
      return;
    }

    this.logger.info('Initializing MCP servers with SDK...');

    if (this.config.mcp?.servers) {
      for (const [name, serverConfigEntry] of Object.entries(this.config.mcp.servers)) {
        const serverConfig = serverConfigEntry;
        if (serverConfig.enabled) {
          await this.startServer(name, serverConfig);
        }
      }
    }
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    this.logger.info('Shutting down MCP SDK clients...');

    for (const [name, runtime] of this.servers) {
      runtime.state = 'shutting_down';

      // Clear reconnect timer so it doesn't fire during shutdown.
      if (runtime.reconnectTimer) {
        clearTimeout(runtime.reconnectTimer);
        runtime.reconnectTimer = undefined;
      }

      this.logger.info({ name }, 'Stopping MCP server');
      try {
        await this.cleanupServerResources(runtime);
      } catch (error) {
        this.logger.error({ err: error, name }, 'Error stopping MCP server');
      }
    }

    this.servers.clear();
    this.removeAllListeners();
  }

  // =========================================================================
  // Server start / connect
  // =========================================================================

  private async startServer(name: string, config: MCPServerConfig): Promise<boolean> {
    const runtime: MCPServerRuntime = {
      name,
      config,
      state: 'starting',
      tools: [],
      reconnectAttempts: 0,
      disconnectHandled: false,
    };
    this.servers.set(name, runtime);

    try {
      await this.connectServer(name, runtime);
      return true;
    } catch (error) {
      runtime.state = 'failed';
      runtime.lastError = error as Error;
      this.logger.error({ err: error, name }, 'Failed to start MCP server');
      this.scheduleReconnect(name);
      return false;
    }
  }

  private async connectServer(name: string, runtime: MCPServerRuntime): Promise<void> {
    this.logger.info({ name, state: runtime.state }, 'Connecting MCP server');

    const client = new Client({
      name: 'Nebula-Link Evo',
      version: '1.0.0',
    });

    const transport = new StdioClientTransport({
      command: runtime.config.command,
      args: runtime.config.args || [],
      env: this.buildServerEnv(name, runtime.config),
      stderr: 'inherit',
    });

    // Reset disconnect guard before binding new listeners.
    runtime.disconnectHandled = false;

    this.bindServerLifecycle(name, runtime, client, transport);

    await client.connect(transport);
    this.logger.info({ name }, 'MCP server connected');

    const tools = await this.fetchToolsList(client);

    // Atomically replace client/transport/tools.
    runtime.client = client;
    runtime.transport = transport;
    runtime.tools = tools;
    runtime.state = 'running';
    runtime.reconnectAttempts = 0;
    runtime.lastError = undefined;
    runtime.lastExitReason = undefined;
    runtime.lastStartedAt = Date.now();

    this.logger.info(
      { name, toolCount: tools.length },
      'MCP server ready',
    );

    if (tools.length > 0) {
      this.emitToolsChanged(name);
    }
  }

  // =========================================================================
  // Crash detection — event-driven lifecycle binding
  // =========================================================================

  private bindServerLifecycle(
    name: string,
    runtime: MCPServerRuntime,
    client: Client,
    transport: StdioClientTransport,
  ): void {
    transport.onclose = () => {
      void this.handleServerDisconnect(name, 'transport_close');
    };

    transport.onerror = (error: Error) => {
      void this.handleServerDisconnect(name, 'transport_error', error);
    };

    client.onclose = () => {
      void this.handleServerDisconnect(name, 'client_close');
    };
  }

  // =========================================================================
  // Disconnect handling (re-entrancy guarded)
  // =========================================================================

  private async handleServerDisconnect(
    name: string,
    reason: string,
    error?: Error,
  ): Promise<void> {
    const runtime = this.servers.get(name);
    if (!runtime) return;

    // Guard against duplicate invocations (onclose + onerror may both fire).
    if (runtime.disconnectHandled) return;
    runtime.disconnectHandled = true;

    this.logger.warn(
      { name, reason, state: runtime.state, err: error },
      'MCP server disconnected',
    );

    const hadTools = runtime.tools.length > 0;

    // Mark state and clear live references.
    runtime.state = this.isShuttingDown ? 'shutting_down' : 'reconnecting';
    runtime.lastExitReason = reason;
    runtime.lastError = error;
    runtime.tools = [];
    runtime.client = undefined;
    runtime.transport = undefined;

    if (hadTools) {
      this.emitToolsChanged(name);
    }

    if (!this.isShuttingDown) {
      this.scheduleReconnect(name);
    }
  }

  // =========================================================================
  // Reconnect scheduling (exponential backoff with jitter)
  // =========================================================================

  private scheduleReconnect(name: string): void {
    const runtime = this.servers.get(name);
    if (!runtime) return;

    if (!this.reconnectPolicy.enabled || this.isShuttingDown) {
      runtime.state = 'failed';
      this.logger.error(
        { name },
        'MCP server permanently failed (reconnect disabled or shutting down)',
      );
      return;
    }

    if (runtime.reconnectAttempts >= this.reconnectPolicy.maxAttempts) {
      runtime.state = 'failed';
      this.logger.error(
        { name, attempts: runtime.reconnectAttempts },
        'MCP server permanently failed (max reconnect attempts reached)',
      );
      return;
    }

    runtime.reconnectAttempts += 1;
    const policy = this.reconnectPolicy;

    const exponential = Math.min(
      policy.baseDelayMs * 2 ** (runtime.reconnectAttempts - 1),
      policy.maxDelayMs,
    );
    const jitter = Math.floor(Math.random() * policy.jitterMs);
    const delay = exponential + jitter;

    this.logger.info(
      { name, attempt: runtime.reconnectAttempts, maxAttempts: policy.maxAttempts, delayMs: delay },
      'MCP server reconnect scheduled',
    );

    runtime.reconnectTimer = setTimeout(() => {
      runtime.reconnectTimer = undefined;
      void this.attemptReconnect(name);
    }, delay);
  }

  private async attemptReconnect(name: string): Promise<void> {
    const runtime = this.servers.get(name);
    if (!runtime || this.isShuttingDown) return;

    this.logger.info(
      { name, attempt: runtime.reconnectAttempts },
      'MCP server reconnecting',
    );

    try {
      await this.connectServer(name, runtime);
      this.logger.info(
        { name, toolCount: runtime.tools.length },
        'MCP server reconnected successfully',
      );
    } catch (error) {
      runtime.lastError = error as Error;
      this.logger.warn(
        { err: error, name, attempt: runtime.reconnectAttempts },
        'MCP server reconnect attempt failed',
      );
      this.scheduleReconnect(name);
    }
  }

  // =========================================================================
  // Resource cleanup
  // =========================================================================

  private async cleanupServerResources(runtime: MCPServerRuntime): Promise<void> {
    if (runtime.reconnectTimer) {
      clearTimeout(runtime.reconnectTimer);
      runtime.reconnectTimer = undefined;
    }

    try {
      if (runtime.transport) {
        await runtime.transport.close();
      }
    } catch {
      // Best-effort close during cleanup.
    }

    runtime.client = undefined;
    runtime.transport = undefined;
    runtime.tools = [];
  }

  // =========================================================================
  // Tools changed event
  // =========================================================================

  private emitToolsChanged(serverName: string): void {
    try {
      this.emit('toolsChanged', { serverName });
    } catch {
      // EventEmitter errors must not disrupt reconnect flow.
    }
  }

  // =========================================================================
  // Tool calls
  // =========================================================================

  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown> = {},
  ): Promise<SDKCallToolResult | MCPToolCallTextResult> {
    const runtime = this.servers.get(serverName);
    if (!runtime) {
      throw new MCPServerUnavailableError(serverName, 'stopped');
    }

    if (runtime.state !== 'running' || !runtime.client) {
      throw new MCPServerUnavailableError(serverName, runtime.state);
    }

    this.logger.info({ serverName, toolName }, 'Calling MCP tool');
    this.logger.debug({ serverName, toolName, args }, 'Calling MCP tool (full args)');

    try {
      const result = await runtime.client.callTool({
        name: toolName,
        arguments: args,
      });

      this.logger.info({ toolName, result: JSON.stringify(result).substring(0, 500) }, 'MCP tool result');

      if (result && result.content && Array.isArray(result.content)) {
        const textContent = result.content
          .filter((c): c is MCPTextContent => c.type === 'text')
          .map((c) => c.text)
          .join('\n');
        if (textContent) {
          return { raw: result, text: textContent, parsed: this.tryParseJson(textContent) };
        }
      }

      return result;
    } catch (error) {
      if (isConnectionClosedError(error)) {
        void this.handleServerDisconnect(serverName, 'call_failure', error as Error);
        throw new MCPServerUnavailableError(serverName, 'reconnecting', error as Error);
      }
      this.logger.error({ err: error, toolName }, 'MCP tool error');
      throw new Error(`Tool call failed: ${(error as Error).message}`);
    }
  }

  // =========================================================================
  // Resource / Prompt accessors
  // =========================================================================

  async listTools(serverName?: string): Promise<MCPTool[]> {
    if (serverName) {
      const runtime = this.servers.get(serverName);
      if (!runtime) {
        throw new Error(`MCP server ${serverName} not found`);
      }
      return runtime.tools;
    }

    return this.getAvailableTools();
  }

  async listResources(serverName: string): Promise<Resource[]> {
    const runtime = this.servers.get(serverName);
    if (!runtime || runtime.state !== 'running' || !runtime.client) {
      throw new MCPServerUnavailableError(serverName, runtime?.state ?? 'stopped');
    }

    try {
      const result = await runtime.client.listResources();
      return result?.resources || [];
    } catch (error) {
      if (isConnectionClosedError(error)) {
        void this.handleServerDisconnect(serverName, 'call_failure', error as Error);
      }
      this.logger.warn({ err: error, serverName }, 'Failed to list resources');
      return [];
    }
  }

  async readResource(serverName: string, uri: string): Promise<ReadResourceResult> {
    const runtime = this.servers.get(serverName);
    if (!runtime || runtime.state !== 'running' || !runtime.client) {
      throw new MCPServerUnavailableError(serverName, runtime?.state ?? 'stopped');
    }

    try {
      const result = await runtime.client.readResource({ uri });
      return result;
    } catch (error) {
      if (isConnectionClosedError(error)) {
        void this.handleServerDisconnect(serverName, 'call_failure', error as Error);
      }
      throw new Error(`Failed to read resource: ${(error as Error).message}`);
    }
  }

  async listPrompts(serverName: string): Promise<Prompt[]> {
    const runtime = this.servers.get(serverName);
    if (!runtime || runtime.state !== 'running' || !runtime.client) {
      throw new MCPServerUnavailableError(serverName, runtime?.state ?? 'stopped');
    }

    try {
      const result = await runtime.client.listPrompts();
      return result?.prompts || [];
    } catch (error) {
      if (isConnectionClosedError(error)) {
        void this.handleServerDisconnect(serverName, 'call_failure', error as Error);
      }
      this.logger.warn({ err: error, serverName }, 'Failed to list prompts');
      return [];
    }
  }

  async getPrompt(serverName: string, name: string, args?: Record<string, string>): Promise<GetPromptResult> {
    const runtime = this.servers.get(serverName);
    if (!runtime || runtime.state !== 'running' || !runtime.client) {
      throw new MCPServerUnavailableError(serverName, runtime?.state ?? 'stopped');
    }

    try {
      const result = await runtime.client.getPrompt({
        name,
        arguments: args || {},
      });
      return result;
    } catch (error) {
      if (isConnectionClosedError(error)) {
        void this.handleServerDisconnect(serverName, 'call_failure', error as Error);
      }
      throw new Error(`Failed to get prompt: ${(error as Error).message}`);
    }
  }

  // =========================================================================
  // Public accessors
  // =========================================================================

  getAvailableTools(): MCPTool[] {
    const tools: MCPTool[] = [];

    for (const [serverName, runtime] of this.servers) {
      if (runtime.state !== 'running') continue;

      for (const tool of runtime.tools) {
        tools.push({
          ...tool,
          name: `${serverName}.${tool.name}`,
        });
      }
    }

    return tools;
  }

  getServerTools(serverName: string): MCPTool[] {
    const runtime = this.servers.get(serverName);
    return runtime?.tools || [];
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isServerRunning(serverName: string): boolean {
    const runtime = this.servers.get(serverName);
    return runtime?.state === 'running';
  }

  getServerState(serverName: string): MCPServerState | undefined {
    return this.servers.get(serverName)?.state;
  }

  getServerList(): { name: string; state: MCPServerState; running: boolean; toolsCount: number }[] {
    const list: { name: string; state: MCPServerState; running: boolean; toolsCount: number }[] = [];

    for (const [name, runtime] of this.servers) {
      list.push({
        name,
        state: runtime.state,
        running: runtime.state === 'running',
        toolsCount: runtime.tools.length,
      });
    }

    return list;
  }

  // =========================================================================
  // Internal helpers
  // =========================================================================

  private buildServerEnv(name: string, config: MCPServerConfig): Record<string, string> {
    const env = { ...getDefaultEnvironment(), ...config.env };

    // Vision-server-specific: inject VISION_* env from defaults.vision provider config.
    // This coupling exists because the vision MCP server needs to know which AI provider
    // to call at runtime. If vision-server is refactored or other servers need similar
    // injection, consider adding a generic `providerEnvPrefix` field to MCPServerConfig.
    if (name !== 'vision-server') {
      return env;
    }

    const defaultVision = this.config.defaults.vision;
    if (!defaultVision?.provider || !defaultVision?.model) {
      this.logger.warn({ name }, 'Skipping vision-server env injection: defaults.vision is not configured');
      return env;
    }

    const provider = this.config.providers[defaultVision.provider];
    if (!provider) {
      this.logger.warn(
        { name, provider: defaultVision.provider },
        'Skipping vision-server env injection: provider not found',
      );
      return env;
    }

    if (!provider.enabled) {
      this.logger.warn(
        { name, provider: defaultVision.provider },
        'Skipping vision-server env injection: provider disabled',
      );
      return env;
    }

    try {
      env.VISION_PROVIDER_BASE_URL = provider.baseUrl ?? '';
      env.VISION_PROVIDER_API_KEY = provider.apiKey;
      env.VISION_MODEL_ID = defaultVision.model;
    } catch (error) {
      const details = error instanceof ProviderError ? error.details : (error as Error).message;
      this.logger.warn({ name, details }, 'Skipping vision-server env injection due to provider config error');
    }

    return env;
  }

  private async fetchToolsList(client: Client): Promise<MCPTool[]> {
    try {
      const result = await client.listTools();
      if (result?.tools) {
        return result.tools.map((tool) => ({
          name: tool.name,
          description: tool.description || '',
          inputSchema: tool.inputSchema || {},
          annotations: tool.annotations ?? undefined,
        }));
      }
      return [];
    } catch (error) {
      this.logger.warn({ err: error }, 'Failed to fetch tools list');
      return [];
    }
  }

  private tryParseJson(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
}
