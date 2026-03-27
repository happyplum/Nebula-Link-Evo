import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { KimiClient } from '../kimi-client.js';

vi.mock('axios');

describe('KimiClient', () => {
  let client: KimiClient;

  beforeEach(() => {
    process.env.KIMI_API_KEY = 'test-key';
    process.env.KIMI_BASE_URL = 'https://api.test.cn/v1';
    process.env.KIMI_MODEL = 'test-model';
    client = new KimiClient();
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with env vars', () => {
      expect((client as any).apiKey).toBe('test-key');
      expect((client as any).baseUrl).toBe('https://api.test.cn/v1');
      expect((client as any).model).toBe('test-model');
    });

    it('should warn if api key is missing', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      process.env.KIMI_API_KEY = '';
      new KimiClient();
      expect(consoleSpy).toHaveBeenCalledWith('KIMI_API_KEY is not set. Kimi API calls will fail.');
      consoleSpy.mockRestore();
    });
  });

  describe('analyze', () => {
    const mockDom = {
      url: 'https://example.com',
      title: 'Example',
      viewport: { width: 1024, height: 768 },
      elements: [
        { tag: 'button', text: 'Submit', bbox: { x: 10, y: 20 } }
      ]
    };
    const mockElements = [
      { type: 'button', center: [15, 25], confidence: 0.95 }
    ];

    it('should call API and parse response', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: '```json\n{"type": "click", "params": {"x": 100, "y": 200}, "reasoning": "test"}\n```'
              }
            }
          ]
        }
      });

      const result = await client.analyze('base64', mockDom, mockElements, 'Click button', [{ action: { type: 'scroll', params: {} } }]);

      expect(axios.post).toHaveBeenCalledWith(
        'https://api.test.cn/v1/chat/completions',
        expect.objectContaining({
          model: 'test-model',
          messages: expect.any(Array)
        }),
        expect.objectContaining({
          headers: {
            Authorization: 'Bearer test-key',
            'Content-Type': 'application/json'
          }
        })
      );

      expect(result).toEqual({
        type: 'click',
        params: { x: 100, y: 200 },
        reasoning: 'test'
      });
    });

    it('should handle missing json in response', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: 'I cannot do that.'
              }
            }
          ]
        }
      });

      const result = await client.analyze('base64', mockDom, mockElements, 'Click button');

      expect(result).toEqual({
        type: 'wait',
        params: {},
        reasoning: '无法解析操作，等待下一步'
      });
    });

    it('should handle invalid json in response', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: '{"type": "click", "params": {invalid}}'
              }
            }
          ]
        }
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = await client.analyze('base64', mockDom, mockElements, 'Click button');

      expect(result).toEqual({
        type: 'wait',
        params: {},
        reasoning: '解析错误，等待下一步'
      });
      consoleSpy.mockRestore();
    });

    it('should handle API error', async () => {
      vi.mocked(axios.post).mockRejectedValueOnce(new Error('Network error'));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await expect(client.analyze('base64', mockDom, mockElements, 'Click button')).rejects.toThrow('Kimi API call failed: Network error');
      consoleSpy.mockRestore();
    });
  });
});
