import { describe, it, expect, vi } from 'vitest';
import { TaskOrchestrator } from '../services/task-orchestrator.js';
import { ActionExecutor } from '../services/action-executor.js';
import { StepRunner } from '../services/step-runner.js';

describe('TaskOrchestrator.substituteParams', () => {
  // Mock dependencies since substituteParams doesn't use them
  const mockActionExecutor = new ActionExecutor({ mcpClient: null });
  const mockStepRunner = new StepRunner({
    actionExecutor: mockActionExecutor,
    clientFactory: {} as any,
    getMCPTools: () => []
  });
  const orchestrator = new TaskOrchestrator({
    actionExecutor: mockActionExecutor,
    stepRunner: mockStepRunner,
    getConfig: () => null
  });

  describe('public visibility', () => {
    it('should be accessible as public method', () => {
      expect(typeof orchestrator.substituteParams).toBe('function');
    });
  });

  describe('simple string substitution', () => {
    it('should replace {{paramName}} with provided value', () => {
      const params = { url: '{{baseUrl}}/api' };
      const paramValues = { baseUrl: 'https://example.com' };

      const result = orchestrator.substituteParams(params, paramValues);

      expect(result.url).toBe('https://example.com/api');
    });

    it('should keep original value when param not found', () => {
      const params = { url: '{{missingParam}}/api' };
      const paramValues = { baseUrl: 'https://example.com' };

      const result = orchestrator.substituteParams(params, paramValues);

      expect(result.url).toBe('{{missingParam}}/api');
    });

    it('should handle multiple params in object', () => {
      const params = {
        url: '{{baseUrl}}/api',
        token: '{{apiKey}}'
      };
      const paramValues = {
        baseUrl: 'https://example.com',
        apiKey: 'secret123'
      };

      const result = orchestrator.substituteParams(params, paramValues);

      expect(result.url).toBe('https://example.com/api');
      expect(result.token).toBe('secret123');
    });

    it('should not modify strings without {{}} pattern', () => {
      const params = { url: 'https://fixed-url.com/api' };
      const paramValues = { baseUrl: 'https://example.com' };

      const result = orchestrator.substituteParams(params, paramValues);

      expect(result.url).toBe('https://fixed-url.com/api');
    });
  });

  describe('nested object substitution', () => {
    it('should recursively substitute params in nested objects', () => {
      const params = {
        request: {
          url: '{{baseUrl}}/api',
          headers: {
            Authorization: '{{token}}'
          }
        }
      };
      const paramValues = {
        baseUrl: 'https://example.com',
        token: 'Bearer xyz'
      };

      const result = orchestrator.substituteParams(params, paramValues) as unknown as { request: { url: string; headers: { Authorization: string } } };

      expect(result.request.url).toBe('https://example.com/api');
      expect(result.request.headers.Authorization).toBe('Bearer xyz');
    });

    it('should handle deeply nested objects', () => {
      const params = {
        level1: {
          level2: {
            level3: {
              value: '{{deepParam}}'
            }
          }
        }
      };
      const paramValues = { deepParam: 'reached!' };

      const result = orchestrator.substituteParams(params, paramValues) as unknown as { level1: { level2: { level3: { value: string } } } };

      expect(result.level1.level2.level3.value).toBe('reached!');
    });

    it('should handle mixed substitution in nested objects', () => {
      const params = {
        request: {
          url: '{{baseUrl}}/api',
          method: 'GET',
          headers: {
            Authorization: '{{token}}',
            'Content-Type': 'application/json'
          }
        }
      };
      const paramValues = {
        baseUrl: 'https://example.com',
        token: 'Bearer xyz'
      };

      const result = orchestrator.substituteParams(params, paramValues) as unknown as { request: { url: string; method: string; headers: { Authorization: string; 'Content-Type': string } } };

      expect(result.request.url).toBe('https://example.com/api');
      expect(result.request.method).toBe('GET');
      expect(result.request.headers.Authorization).toBe('Bearer xyz');
      expect(result.request.headers['Content-Type']).toBe('application/json');
    });
  });

  describe('array substitution', () => {
    it('should substitute params in array elements', () => {
      const params = {
        urls: ['{{baseUrl}}/api1', '{{baseUrl}}/api2', 'fixed-url']
      };
      const paramValues = { baseUrl: 'https://example.com' };

      const result = orchestrator.substituteParams(params, paramValues);

      expect(result.urls).toEqual([
        'https://example.com/api1',
        'https://example.com/api2',
        'fixed-url'
      ]);
    });

    it('should handle arrays with non-string elements', () => {
      const params = {
        mixed: ['{{param1}}', 123, true, { key: '{{param2}}' }]
      };
      const paramValues = {
        param1: 'value1',
        param2: 'value2'
      };

      const result = orchestrator.substituteParams(params, paramValues);

      expect(result.mixed).toEqual([
        'value1',
        123,
        true,
        { key: 'value2' }
      ]);
    });

    it('should keep array structure unchanged', () => {
      const params = {
        urls: ['{{baseUrl}}/api']
      };
      const paramValues = { baseUrl: 'https://example.com' };

      const result = orchestrator.substituteParams(params, paramValues);

      expect(Array.isArray(result.urls)).toBe(true);
    });
  });

  describe('complex scenarios', () => {
    it('should handle object with nested arrays and objects', () => {
      const params = {
        config: {
          api: {
            endpoints: ['{{baseUrl}}/users', '{{baseUrl}}/posts'],
            headers: {
              'X-API-Key': '{{apiKey}}'
            }
          },
          other: 'fixed'
        }
      };
      const paramValues = {
        baseUrl: 'https://api.example.com',
        apiKey: 'secret-key'
      };

      const result = orchestrator.substituteParams(params, paramValues) as unknown as { config: { api: { endpoints: string[]; headers: { 'X-API-Key': string } }; other: string } };

      expect(result.config.api.endpoints).toEqual([
        'https://api.example.com/users',
        'https://api.example.com/posts'
      ]);
      expect(result.config.api.headers['X-API-Key']).toBe('secret-key');
      expect(result.config.other).toBe('fixed');
    });

    it('should handle empty objects and arrays', () => {
      const params = {
        emptyObj: {},
        emptyArr: [],
        normal: '{{param}}'
      };
      const paramValues = { param: 'value' };

      const result = orchestrator.substituteParams(params, paramValues);

      expect(result.emptyObj).toEqual({});
      expect(result.emptyArr).toEqual([]);
      expect(result.normal).toBe('value');
    });

    it('should handle null and undefined values', () => {
      const params = {
        nullValue: null,
        numberValue: 42,
        booleanValue: true,
        stringValue: '{{param}}'
      };
      const paramValues = { param: 'value' };

      const result = orchestrator.substituteParams(params, paramValues);

      expect(result.nullValue).toBeNull();
      expect(result.numberValue).toBe(42);
      expect(result.booleanValue).toBe(true);
      expect(result.stringValue).toBe('value');
    });
  });

  describe('backward compatibility', () => {
    it('should work with existing simple parameter patterns', () => {
      const params = {
        selector: '{{buttonId}}',
        text: '{{inputText}}'
      };
      const paramValues = {
        buttonId: '#submit-btn',
        inputText: 'Hello World'
      };

      const result = orchestrator.substituteParams(params, paramValues);

      expect(result.selector).toBe('#submit-btn');
      expect(result.text).toBe('Hello World');
    });

    it('should preserve non-param string values', () => {
      const params = {
        url: 'https://example.com',
        path: '/api/users'
      };
      const paramValues = { baseUrl: 'https://other.com' };

      const result = orchestrator.substituteParams(params, paramValues);

      expect(result.url).toBe('https://example.com');
      expect(result.path).toBe('/api/users');
    });
  });
});
