import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from './loader.js';
import type { Config } from './schema.js';

function writeConfig(config: Config): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nebula-ai-config-'));
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config), 'utf-8');
  return configPath;
}

function createConfig(mcp: Config['mcp']): Config {
  return {
    version: '2.0',
    providers: {
      glm: {
        enabled: false,
        apiKey: '',
      },
    },
    mcp,
    defaults: {
      mode: 'unified',
      decision: 'glm/test-model',
    },
    settings: {
      timeout: 30000,
      maxRetries: 3,
      temperature: 0.2,
      maxTokens: 1000,
      maxSteps: 1,
    },
  };
}

describe('loadConfig gateway MCP registration', () => {
  const previousGatewayUrl = process.env.PROXY_ADAPTER_URL;

  beforeEach(() => {
    process.env.PROXY_ADAPTER_URL = 'http://127.0.0.1:3000';
  });

  afterEach(() => {
    if (previousGatewayUrl === undefined) {
      delete process.env.PROXY_ADAPTER_URL;
    } else {
      process.env.PROXY_ADAPTER_URL = previousGatewayUrl;
    }
  });

  it('registers the proxy gateway as a required HTTP MCP server', () => {
    const configPath = writeConfig(createConfig({ enabled: true, servers: {} }));

    const result = loadConfig(configPath);

    expect(result.config?.mcp.servers.gateway).toEqual({
      enabled: true,
      command: '',
      args: [],
      env: {},
      url: 'http://127.0.0.1:3000/mcp',
    });
  });

  it('registers the required gateway even when extension MCP is disabled', () => {
    const configPath = writeConfig(createConfig({ enabled: false, servers: {} }));

    const result = loadConfig(configPath);

    expect(result.config?.mcp.enabled).toBe(true);
    expect(result.config?.mcp.servers.gateway?.enabled).toBe(true);
  });

  it('rejects a configured server that tries to occupy the reserved gateway name', () => {
    const configPath = writeConfig(
      createConfig({
        enabled: true,
        servers: {
          gateway: {
            enabled: false,
            command: '',
            args: [],
            env: {},
            url: 'http://127.0.0.1:3000/mcp',
          },
        },
      })
    );

    const result = loadConfig(configPath);

    expect(result.config).toBeNull();
    expect(result.result.success).toBe(false);
  });
});
