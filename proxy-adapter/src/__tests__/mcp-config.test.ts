import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('MCP Config', () => {
  const configPath = resolve(process.cwd(), '..', 'config', 'config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));

  it('should have mcp enabled', () => {
    expect(config.mcp.enabled).toBe(true);
  });
});
