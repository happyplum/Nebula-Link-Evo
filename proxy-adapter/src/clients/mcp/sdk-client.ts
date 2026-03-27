import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { ResolvedConfig, MCPServerConfig } from '../../config/schema.js';

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: object;
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

  constructor(config: ResolvedConfig) {
    this.config = config;
    this.enabled = config.mcp?.enabled ?? false;
  }

  async initialize(): Promise<void> {
    if (!this.enabled) {
      console.log('MCP is disabled');
      return;
    }

    console.log('Initializing MCP servers with SDK...');

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
      console.log(`Starting MCP server: ${name}`);

      const client = new Client({
        name: 'Nebula-Link Evo',
        version: '1.0.0',
      });

      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args || [],
        env: { ...getDefaultEnvironment(), ...config.env },
        stderr: 'inherit',
      });

      await client.connect(transport);
      console.log(`MCP server ${name} connected`);

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
      console.error(`Failed to start MCP server ${name}:`, error);
      return false;
    }
  }

  private async fetchToolsList(client: Client): Promise<MCPTool[]> {
    try {
      const result = await client.listTools();
      if (result?.tools) {
        return result.tools.map((tool) => ({
          name: tool.name,
          description: tool.description || '',
          inputSchema: tool.inputSchema || {},
        }));
      }
      return [];
    } catch (error) {
      console.warn('Failed to fetch tools list:', (error as Error).message);
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
    args: Record<string, any> = {}
  ): Promise<any> {
    const server = this.servers.get(serverName);
    if (!server || !server.running) {
      throw new Error(`MCP server ${serverName} is not running`);
    }

    console.log(`Calling ${serverName}.${toolName}(${JSON.stringify(args)})`);

    try {
      const result = await server.client.callTool({
        name: toolName,
        arguments: args,
      });

      console.log(
        `MCP tool ${toolName} result:`,
        JSON.stringify(result, null, 2).substring(0, 500)
      );

      if (result && result.content && Array.isArray(result.content)) {
        const textContent = result.content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text)
          .join('\n');
        if (textContent) {
          return { raw: result, text: textContent, parsed: this.tryParseJson(textContent) };
        }
      }

      return result;
    } catch (error) {
      console.error(`MCP tool ${toolName} error:`, error);
      throw new Error(`Tool call failed: ${(error as Error).message}`);
    }
  }

  private tryParseJson(text: string): any {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  async listResources(serverName: string): Promise<any[]> {
    const server = this.servers.get(serverName);
    if (!server || !server.running) {
      throw new Error(`MCP server ${serverName} is not running`);
    }

    try {
      const result = await server.client.listResources();
      return result?.resources || [];
    } catch (error) {
      console.warn(`Failed to list resources for ${serverName}:`, (error as Error).message);
      return [];
    }
  }

  async readResource(serverName: string, uri: string): Promise<any> {
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

  async listPrompts(serverName: string): Promise<any[]> {
    const server = this.servers.get(serverName);
    if (!server || !server.running) {
      throw new Error(`MCP server ${serverName} is not running`);
    }

    try {
      const result = await server.client.listPrompts();
      return result?.prompts || [];
    } catch (error) {
      console.warn(`Failed to list prompts for ${serverName}:`, (error as Error).message);
      return [];
    }
  }

  async getPrompt(serverName: string, name: string, args?: Record<string, any>): Promise<any> {
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
    console.log('Shutting down MCP SDK clients...');

    for (const [name, server] of this.servers) {
      if (server.running) {
        console.log(`Stopping MCP server: ${name}`);
        try {
          await server.transport.close();
          server.running = false;
        } catch (error) {
          console.error(`Error stopping ${name}:`, error);
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
