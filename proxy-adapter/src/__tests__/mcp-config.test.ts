import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('MCP Config', () => {
  const configPath = resolve(process.cwd(), '..', 'config', 'config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));

  it('should have mcp enabled', () => {
    expect(config.mcp.enabled).toBe(true);
  });

  it('should have browser-control server enabled', () => {
    expect(config.mcp.servers['browser-control'].enabled).toBe(true);
  });

  it('should have browser-control server with correct command', () => {
    expect(config.mcp.servers['browser-control'].command).toBe('npx');
    expect(config.mcp.servers['browser-control'].args).toContain('--cdp-endpoint');
  });
});
