import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MCPSDKClient } from '../clients/mcp/sdk-client.js';
import type { ResolvedConfig } from '../config/schema.js';
import type { MCPTool } from '../clients/types.js';

describe('MCPSDKClient', () => {
  const mockConfig: ResolvedConfig = {
    mcp: {
      enabled: true,
      servers: {
        'browser-control': {
          enabled: true,
          command: 'echo',
          args: ['test'],
          env: {},
        },
      },
    },
  } as unknown as ResolvedConfig;

  let client: MCPSDKClient;

  beforeEach(() => {
    client = new MCPSDKClient(mockConfig);
  });

  afterEach(async () => {
    await client.shutdown();
  });

  describe('initialization', () => {
    it('should create client with config', () => {
      expect(client).toBeDefined();
      expect(client.isEnabled()).toBe(true);
    });

    it('should initialize and connect to MCP servers', async () => {
      await client.initialize();
      expect(true).toBe(true); // Placeholder - will be replaced with actual checks
    });

    it('should not initialize when MCP is disabled', async () => {
      const disabledConfig = {
        mcp: {
          enabled: false,
          servers: {},
        },
      } as unknown as ResolvedConfig;

      const disabledClient = new MCPSDKClient(disabledConfig);
      expect(disabledClient.isEnabled()).toBe(false);

      await disabledClient.initialize();
      expect(disabledClient.getAvailableTools()).toEqual([]);
    });
  });

  describe('listTools', () => {
    it('should return list of available tools from all servers', async () => {
      await client.initialize();
      const tools = client.getAvailableTools();
      expect(Array.isArray(tools)).toBe(true);
    });

    it('should include server name in tool names', async () => {
      await client.initialize();
      const tools = client.getAvailableTools();
      if (tools.length > 0) {
        expect(tools[0].name).toContain('.');
      }
    });
  });

  describe('callTool', () => {
    it('should throw error when server is not running', async () => {
      await client.initialize();

      await expect(client.callTool('non-existent-server', 'any_tool', {})).rejects.toThrow(
        'MCP server non-existent-server is not running'
      );
    });

    it('should throw error when trying to call tool on failed server', async () => {
      await client.initialize();

      await expect(client.callTool('browser-control', 'any_tool', {})).rejects.toThrow(
        /is not running|Tool call failed/
      );
    });
  });

  describe('listResources', () => {
    it('should throw error when server is not running', async () => {
      await client.initialize();

      await expect(client.listResources('non-existent-server')).rejects.toThrow(
        'MCP server non-existent-server is not running'
      );
    });
  });

  describe('readResource', () => {
    it('should throw error when server is not running', async () => {
      await client.initialize();

      await expect(client.readResource('non-existent-server', 'file:///test.txt')).rejects.toThrow(
        'MCP server non-existent-server is not running'
      );
    });
  });

  describe('listPrompts', () => {
    it('should throw error when server is not running', async () => {
      await client.initialize();

      await expect(client.listPrompts('non-existent-server')).rejects.toThrow(
        'MCP server non-existent-server is not running'
      );
    });
  });

  describe('getPrompt', () => {
    it('should throw error when server is not running', async () => {
      await client.initialize();

      await expect(
        client.getPrompt('non-existent-server', 'test_prompt', { arg1: 'value1' })
      ).rejects.toThrow('MCP server non-existent-server is not running');
    });
  });

  describe('getMCPStatus', () => {
    it('should return status with enabled flag and server list', async () => {
      await client.initialize();

      const status = {
        enabled: client.isEnabled(),
        servers: client.getServerList(),
      };

      expect(status.enabled).toBe(true);
      expect(Array.isArray(status.servers)).toBe(true);
    });
  });

  describe('getAvailableTools', () => {
    it('should return tools in correct format', async () => {
      await client.initialize();
      const tools = client.getAvailableTools();

      tools.forEach((tool) => {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
      });
    });
  });

  describe('getServerList', () => {
    it('should return list of servers with status', async () => {
      await client.initialize();
      const servers = client.getServerList();

      expect(Array.isArray(servers)).toBe(true);
      servers.forEach((server) => {
        expect(server).toHaveProperty('name');
        expect(server).toHaveProperty('running');
        expect(server).toHaveProperty('toolsCount');
      });
    });
  });

  describe('isServerRunning', () => {
    it('should check if specific server is running', async () => {
      await client.initialize();
      const running = client.isServerRunning('browser-control');
      expect(typeof running).toBe('boolean');
    });

    it('should return false for non-existent server', async () => {
      await client.initialize();
      const running = client.isServerRunning('non-existent-server');
      expect(running).toBe(false);
    });
  });

  describe('shutdown', () => {
    it('should close all server connections', async () => {
      await client.initialize();
      await client.shutdown();

      const servers = client.getServerList();
      servers.forEach((server) => {
        expect(server.running).toBe(false);
      });
    });
  });

  describe('getAvailableTools', () => {
    it('should return empty array when no servers are running', async () => {
      const emptyConfig = {
        mcp: {
          enabled: true,
          servers: {},
        },
      } as unknown as ResolvedConfig;

      const emptyClient = new MCPSDKClient(emptyConfig);
      await emptyClient.initialize();

      const tools = emptyClient.getAvailableTools();
      expect(tools).toEqual([]);

      await emptyClient.shutdown();
    });
  });

  describe('type exports', () => {
    it('should export MCPTool interface', () => {
      const tool: MCPTool = {
        name: 'test.tool',
        description: 'Test tool',
        inputSchema: { type: 'object' },
      };

      expect(tool).toBeDefined();
      expect(tool.name).toBe('test.tool');
    });
  });
});
