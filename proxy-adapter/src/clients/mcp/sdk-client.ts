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

interface MCPServerInfo {
  name: string;
  config: MCPServerConfig;
  client: Client;
  transport: StdioClientTransport;
  tools: MCPTool[];
  running: boolean;
}

export class MCPSDKClient {
  private config: ResolvedConfig;
  private servers: Map<string, MCPServerInfo> = new Map();
  private enabled: boolean = false;
  private logger: Logger;

  constructor(config: ResolvedConfig, logger?: Logger) {
    this.config = config;
    this.enabled = config.mcp?.enabled ?? false;
    this.logger = logger ?? createWorkerLogger('mcp-sdk-client');
  }

  async initialize(): Promise<void> {
    if (!this.enabled) {
      this.logger.info('MCP is disabled');
      return;
    }

    this.logger.info('Initializing MCP servers with SDK...');

    if (this.config.mcp?.servers) {
      for (const [name, serverConfigEntry] of Object.entries(this.config.mcp.servers)) {
        const serverConfig = serverConfigEntry as MCPServerConfig;
        if (serverConfig.enabled) {
          await this.startServer(name, serverConfig);
        }
      }
    }
  }

  private async startServer(name: string, config: MCPServerConfig): Promise<boolean> {
    try {
      this.logger.info({ name }, 'Starting MCP server');

      const client = new Client({
        name: 'Nebula-Link Evo',
        version: '1.0.0',
      });

      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args || [],
        env: this.buildServerEnv(name, config),
        stderr: 'inherit',
      });

      await client.connect(transport);
      this.logger.info({ name }, 'MCP server connected');

      const tools = await this.fetchToolsList(client);

      const serverInfo: MCPServerInfo = {
        name,
        config,
        client,
        transport,
        tools,
        running: true,
      };

      this.servers.set(name, serverInfo);
      return true;
    } catch (error) {
      this.logger.error({ err: error, name }, 'Failed to start MCP server');
      return false;
    }
  }

  private buildServerEnv(name: string, config: MCPServerConfig): Record<string, string> {
    const env = { ...getDefaultEnvironment(), ...config.env };

    if (name !== 'vision-server') {
      return env;
    }

    const rawDefaults = this.config as ResolvedConfig & { defaults: ResolvedConfig['defaults'] & { vision?: { provider: string; model: string } } };
    const defaultVision = rawDefaults.defaults.vision;
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

  async listTools(serverName?: string): Promise<MCPTool[]> {
    if (serverName) {
      const server = this.servers.get(serverName);
      if (!server) {
        throw new Error(`MCP server ${serverName} not found`);
      }
      return server.tools;
    }

    return this.getAvailableTools();
  }

  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown> = {}
  ): Promise<SDKCallToolResult | MCPToolCallTextResult> {
    const server = this.servers.get(serverName);
    if (!server || !server.running) {
      throw new Error(`MCP server ${serverName} is not running`);
    }

    this.logger.info({ serverName, toolName }, 'Calling MCP tool');
    this.logger.debug({ serverName, toolName, args }, 'Calling MCP tool (full args)');

    try {
      const result = await server.client.callTool({
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
      this.logger.error({ err: error, toolName }, 'MCP tool error');
      throw new Error(`Tool call failed: ${(error as Error).message}`);
    }
  }

  private tryParseJson(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  async listResources(serverName: string): Promise<Resource[]> {
    const server = this.servers.get(serverName);
    if (!server || !server.running) {
      throw new Error(`MCP server ${serverName} is not running`);
    }

    try {
      const result = await server.client.listResources();
      return result?.resources || [];
    } catch (error) {
      this.logger.warn({ err: error, serverName }, 'Failed to list resources');
      return [];
    }
  }

  async readResource(serverName: string, uri: string): Promise<ReadResourceResult> {
    const server = this.servers.get(serverName);
    if (!server || !server.running) {
      throw new Error(`MCP server ${serverName} is not running`);
    }

    try {
      const result = await server.client.readResource({ uri });
      return result;
    } catch (error) {
      throw new Error(`Failed to read resource: ${(error as Error).message}`);
    }
  }

  async listPrompts(serverName: string): Promise<Prompt[]> {
    const server = this.servers.get(serverName);
    if (!server || !server.running) {
      throw new Error(`MCP server ${serverName} is not running`);
    }

    try {
      const result = await server.client.listPrompts();
      return result?.prompts || [];
    } catch (error) {
      this.logger.warn({ err: error, serverName }, 'Failed to list prompts');
      return [];
    }
  }

  async getPrompt(serverName: string, name: string, args?: Record<string, string>): Promise<GetPromptResult> {
    const server = this.servers.get(serverName);
    if (!server || !server.running) {
      throw new Error(`MCP server ${serverName} is not running`);
    }

    try {
      const result = await server.client.getPrompt({
        name,
        arguments: args || {},
      });
      return result;
    } catch (error) {
      throw new Error(`Failed to get prompt: ${(error as Error).message}`);
    }
  }

  getAvailableTools(): MCPTool[] {
    const tools: MCPTool[] = [];

    for (const [serverName, server] of this.servers) {
      if (!server.running) continue;

      for (const tool of server.tools) {
        tools.push({
          ...tool,
          name: `${serverName}.${tool.name}`,
        });
      }
    }

    return tools;
  }

  getServerTools(serverName: string): MCPTool[] {
    const server = this.servers.get(serverName);
    return server?.tools || [];
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isServerRunning(serverName: string): boolean {
    const server = this.servers.get(serverName);
    return server?.running || false;
  }

  async shutdown(): Promise<void> {
    this.logger.info('Shutting down MCP SDK clients...');

    for (const [name, server] of this.servers) {
      if (server.running) {
        this.logger.info({ name }, 'Stopping MCP server');
        try {
          await server.transport.close();
          server.running = false;
        } catch (error) {
          this.logger.error({ err: error, name }, 'Error stopping MCP server');
        }
      }
    }

    this.servers.clear();
  }

  getServerList(): { name: string; running: boolean; toolsCount: number }[] {
    const list: { name: string; running: boolean; toolsCount: number }[] = [];

    for (const [name, server] of this.servers) {
      list.push({
        name,
        running: server.running,
        toolsCount: server.tools.length,
      });
    }

    return list;
  }
}
