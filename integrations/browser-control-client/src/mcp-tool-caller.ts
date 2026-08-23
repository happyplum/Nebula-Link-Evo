import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export interface McpToolCaller {
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
  close(): Promise<void>;
}

export class StreamableHttpMcpToolCaller implements McpToolCaller {
  private client?: Client;
  private transport?: StreamableHTTPClientTransport;
  private connecting?: Promise<Client>;

  constructor(private readonly url: URL) {}

  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<unknown> {
    const client = await this.getClient();
    try {
      return await client.callTool({ name, arguments: args }, undefined, { signal });
    } catch (error) {
      await this.reset();
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.reset();
  }

  private async getClient(): Promise<Client> {
    if (this.client) return this.client;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      const client = new Client({ name: 'nebula-browser-client', version: '0.1.0' });
      const transport = new StreamableHTTPClientTransport(this.url);
      await client.connect(transport);
      this.client = client;
      this.transport = transport;
      return client;
    })();

    try {
      return await this.connecting;
    } finally {
      this.connecting = undefined;
    }
  }

  private async reset(): Promise<void> {
    const transport = this.transport;
    this.client = undefined;
    this.transport = undefined;
    this.connecting = undefined;
    if (transport) {
      try {
        await transport.close();
      } catch {
        // Best-effort transport cleanup.
      }
    }
  }
}
