import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { z } from 'zod';
import { loadConfig } from '../config.js';

const REQUIRED_VARS = [
  'VISION_PROVIDER_BASE_URL',
  'VISION_PROVIDER_API_KEY',
  'VISION_MODEL_ID',
] as const;

const OPTIONAL_VARS = [
  'PLAYWRIGHT_SERVER_URL',
  'VISION_MAX_TOKENS',
  'VISION_TEMPERATURE',
  'VISION_TIMEOUT_MS',
  'VISION_MAX_RETRIES',
] as const;

const ALL_VARS = [...REQUIRED_VARS, ...OPTIONAL_VARS] as const;

let savedEnv: Record<string, string | undefined>;

describe('config', () => {
  beforeAll(() => {
    savedEnv = {};
    for (const key of ALL_VARS) {
      savedEnv[key] = process.env[key];
    }
  });

  afterEach(() => {
    // Clear all vision-related env vars after each test
    for (const key of ALL_VARS) {
      delete process.env[key];
    }
  });

  afterAll(() => {
    // Restore original env
    for (const key of ALL_VARS) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  describe('loadConfig', () => {
    it('applies default values when optional vars are missing', () => {
      process.env.VISION_PROVIDER_BASE_URL = 'https://api.example.com';
      process.env.VISION_PROVIDER_API_KEY = 'test-key';
      process.env.VISION_MODEL_ID = 'test-model';

      const config = loadConfig();

      expect(config.PLAYWRIGHT_SERVER_URL).toBe('http://localhost:3001');
      expect(config.VISION_MAX_TOKENS).toBe(2048);
      expect(config.VISION_TEMPERATURE).toBe(0.1);
      expect(config.VISION_TIMEOUT_MS).toBe(30000);
      expect(config.VISION_MAX_RETRIES).toBe(2);
    });

    it('returns required values from environment', () => {
      process.env.VISION_PROVIDER_BASE_URL = 'https://api.example.com/v1';
      process.env.VISION_PROVIDER_API_KEY = 'sk-secret';
      process.env.VISION_MODEL_ID = 'gpt-4o';

      const config = loadConfig();

      expect(config.VISION_PROVIDER_BASE_URL).toBe('https://api.example.com/v1');
      expect(config.VISION_PROVIDER_API_KEY).toBe('sk-secret');
      expect(config.VISION_MODEL_ID).toBe('gpt-4o');
    });

    it('throws ZodError when VISION_PROVIDER_BASE_URL is missing', () => {
      process.env.VISION_PROVIDER_API_KEY = 'key';
      process.env.VISION_MODEL_ID = 'model';

      expect(() => loadConfig()).toThrow(z.ZodError);
    });

    it('throws ZodError when VISION_PROVIDER_API_KEY is missing', () => {
      process.env.VISION_PROVIDER_BASE_URL = 'https://api.example.com';
      process.env.VISION_MODEL_ID = 'model';

      expect(() => loadConfig()).toThrow(z.ZodError);
    });

    it('throws ZodError when VISION_MODEL_ID is missing', () => {
      process.env.VISION_PROVIDER_BASE_URL = 'https://api.example.com';
      process.env.VISION_PROVIDER_API_KEY = 'key';

      expect(() => loadConfig()).toThrow(z.ZodError);
    });

    it('coerces string env vars to numbers', () => {
      process.env.VISION_PROVIDER_BASE_URL = 'https://api.example.com';
      process.env.VISION_PROVIDER_API_KEY = 'key';
      process.env.VISION_MODEL_ID = 'model';
      process.env.VISION_MAX_TOKENS = '4096';
      process.env.VISION_TEMPERATURE = '0.5';
      process.env.VISION_TIMEOUT_MS = '60000';
      process.env.VISION_MAX_RETRIES = '5';

      const config = loadConfig();

      expect(config.VISION_MAX_TOKENS).toBe(4096);
      expect(typeof config.VISION_MAX_TOKENS).toBe('number');
      expect(config.VISION_TEMPERATURE).toBe(0.5);
      expect(typeof config.VISION_TEMPERATURE).toBe('number');
      expect(config.VISION_TIMEOUT_MS).toBe(60000);
      expect(typeof config.VISION_TIMEOUT_MS).toBe('number');
      expect(config.VISION_MAX_RETRIES).toBe(5);
      expect(typeof config.VISION_MAX_RETRIES).toBe('number');
    });

    it('rejects invalid VISION_TEMPERATURE above 2', () => {
      process.env.VISION_PROVIDER_BASE_URL = 'https://api.example.com';
      process.env.VISION_PROVIDER_API_KEY = 'key';
      process.env.VISION_MODEL_ID = 'model';
      process.env.VISION_TEMPERATURE = '3.0';

      expect(() => loadConfig()).toThrow(z.ZodError);
    });

    it('rejects negative VISION_TEMPERATURE', () => {
      process.env.VISION_PROVIDER_BASE_URL = 'https://api.example.com';
      process.env.VISION_PROVIDER_API_KEY = 'key';
      process.env.VISION_MODEL_ID = 'model';
      process.env.VISION_TEMPERATURE = '-0.5';

      expect(() => loadConfig()).toThrow(z.ZodError);
    });

    it('rejects non-positive VISION_MAX_TOKENS', () => {
      process.env.VISION_PROVIDER_BASE_URL = 'https://api.example.com';
      process.env.VISION_PROVIDER_API_KEY = 'key';
      process.env.VISION_MODEL_ID = 'model';
      process.env.VISION_MAX_TOKENS = '0';

      expect(() => loadConfig()).toThrow(z.ZodError);
    });

    it('allows VISION_MAX_RETRIES of 0', () => {
      process.env.VISION_PROVIDER_BASE_URL = 'https://api.example.com';
      process.env.VISION_PROVIDER_API_KEY = 'key';
      process.env.VISION_MODEL_ID = 'model';
      process.env.VISION_MAX_RETRIES = '0';

      const config = loadConfig();

      expect(config.VISION_MAX_RETRIES).toBe(0);
    });
  });
});
