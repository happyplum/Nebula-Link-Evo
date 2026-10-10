import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ApiClient, ApiError, apiClient } from '../client.js';

describe('ApiClient', () => {
  let client: ApiClient;

  beforeEach(() => {
    client = new ApiClient();
    vi.restoreAllMocks();
  });

  describe('get', () => {
    it('should fetch JSON and return parsed data', async () => {
      const data = { status: 'ok' };
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify(data), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const result = await client.get<{ status: string }>('/api/health');
      expect(result).toEqual(data);
      expect(fetch).toHaveBeenCalledWith('/api/health', { signal: expect.any(AbortSignal) });
    });

    it('should append query params when provided', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      await client.get('/debug/api/tasks', { limit: '10' });
      expect(fetch).toHaveBeenCalledWith('/debug/api/tasks?limit=10', {
        signal: expect.any(AbortSignal),
      });
    });

    it('should throw ApiError on non-ok response', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: 'Not Found' }), {
            status: 404,
            statusText: 'Not Found',
          })
        )
      );

      try {
        await client.get('/api/missing');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.status).toBe(404);
        expect(apiErr.statusText).toBe('Not Found');
        expect(apiErr.body).toEqual({ error: 'Not Found' });
      }
    });
  });

  describe('post', () => {
    it('should send JSON body with Content-Type header', async () => {
      const body = { url: 'https://example.com', instruction: 'click' };
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ taskId: '123' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const result = await client.post<{ taskId: string }>('/api/task', body);
      expect(result).toEqual({ taskId: '123' });
      expect(fetch).toHaveBeenCalledWith('/api/task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: expect.any(AbortSignal),
      });
    });

    it('should send POST without body when omitted', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      await client.post('/debug/api/playwright/open');
      expect(fetch).toHaveBeenCalledWith('/debug/api/playwright/open', {
        method: 'POST',
        signal: expect.any(AbortSignal),
      });
    });

    it('should throw ApiError on server error', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ detail: 'Internal error' }), {
          status: 500,
          statusText: 'Internal Server Error',
        })
      );

      await expect(client.post('/api/task', {})).rejects.toThrow(ApiError);
    });
  });

  describe('delete', () => {
    it('should send DELETE request', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));

      const result = await client.delete('/api/resource/1');
      expect(result).toBeUndefined();
      expect(fetch).toHaveBeenCalledWith('/api/resource/1', {
        method: 'DELETE',
        signal: expect.any(AbortSignal),
      });
    });
  });

  describe('ApiError', () => {
    it('should have correct properties', () => {
      const err = new ApiError(401, 'Unauthorized', { message: 'token expired' });
      expect(err.name).toBe('ApiError');
      expect(err.status).toBe(401);
      expect(err.statusText).toBe('Unauthorized');
      expect(err.body).toEqual({ message: 'token expired' });
      expect(err.message).toBe('API error 401: Unauthorized');
    });
  });

  describe('apiClient singleton', () => {
    it('should be an instance of ApiClient', () => {
      expect(apiClient).toBeInstanceOf(ApiClient);
    });
  });
});
