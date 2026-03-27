import { describe, it, expect, vi } from 'vitest';
import { fetch_get, fetch_post } from '../clients/mcp/servers/fetch.js';

describe('fetch_get', () => {
  it('should successfully fetch GET request', async () => {
    const mockResponse = { data: 'test' };
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockResponse),
        })
      )
    );

    const result = await fetch_get('https://example.com');

    expect(result.success).toBe(true);
    expect(result.data).toEqual(mockResponse);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(200);
  });

  it('should handle network error gracefully', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('Network error')))
    );

    const result = await fetch_get('https://example.com');

    expect(result.success).toBe(false);
    expect(result.data).toBeUndefined();
    expect(result.error).toBe('Network error');
    expect(result.status).toBe(0);
  });

  it('should handle HTTP error response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 404,
          json: () => Promise.resolve({ error: 'Not found' }),
        })
      )
    );

    const result = await fetch_get('https://example.com');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Not found');
    expect(result.status).toBe(404);
  });

  it('should accept custom options', async () => {
    const customOptions = { headers: { 'X-Custom': 'value' } };
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: 'test' }),
        })
      )
    );

    await fetch_get('https://example.com', customOptions);

    expect(fetch).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-Custom': 'value',
        },
        signal: expect.any(AbortSignal),
      })
    );
  });

  it('should use default timeout of 30000ms', async () => {
    const options = { headers: { 'X-Custom': 'value' } };
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: 'test' }),
        })
      )
    );

    await fetch_get('https://example.com', options);

    expect(fetch).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-Custom': 'value',
        },
        signal: expect.any(AbortSignal),
      })
    );
  });
});

describe('fetch_post', () => {
  it('should successfully fetch POST request', async () => {
    const body = { key: 'value' };
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 201,
          json: () => Promise.resolve({ data: 'created', body }),
        })
      )
    );

    const result = await fetch_post('https://example.com', body);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ data: 'created', body });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(201);
  });

  it('should handle network error gracefully', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('Network error')))
    );

    const result = await fetch_post('https://example.com');

    expect(result.success).toBe(false);
    expect(result.data).toBeUndefined();
    expect(result.error).toBe('Network error');
    expect(result.status).toBe(0);
  });

  it('should handle HTTP error response', async () => {
    const body = { test: 'data' };
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: 'Server error' }),
        })
      )
    );

    const result = await fetch_post('https://example.com', body);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Server error');
    expect(result.status).toBe(500);
  });

  it('should accept custom options', async () => {
    const body = { key: 'value' };
    const customOptions = { headers: { 'X-Custom': 'value' } };
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: 'test' }),
        })
      )
    );

    await fetch_post('https://example.com', body, customOptions);

    expect(fetch).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Custom': 'value',
        },
        body: JSON.stringify(body),
        signal: expect.any(AbortSignal),
      })
    );
  });

  it('should use default timeout of 30000ms', async () => {
    const body = { key: 'value' };
    const options = { headers: { 'X-Custom': 'value' } };
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: 'test' }),
        })
      )
    );

    await fetch_post('https://example.com', body, options);

    expect(fetch).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Custom': 'value',
        },
        body: JSON.stringify(body),
        signal: expect.any(AbortSignal),
      })
    );
  });
});
