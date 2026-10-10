import { afterEach, describe, expect, it } from 'vitest';
import { start } from '../server.js';

const originalHost = process.env.HOST;

afterEach(() => {
  if (originalHost === undefined) delete process.env.HOST;
  else process.env.HOST = originalHost;
});

describe('proxy-adapter bind boundary', () => {
  it('rejects a non-loopback host before building the application', async () => {
    process.env.HOST = '0.0.0.0';

    await expect(start()).rejects.toThrow('proxy-adapter must bind to a loopback host');
  });
});
