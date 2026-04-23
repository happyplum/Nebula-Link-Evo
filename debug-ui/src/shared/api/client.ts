/**
 * HTTP client wrapper for REST API requests.
 * SSE, WebSocket, and MJPEG are explicitly out of scope (Phase 2).
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly body: unknown,
  ) {
    super(`API error ${status}: ${statusText}`);
    this.name = 'ApiError';
  }
}

export class ApiClient {
  private static readonly DEFAULT_TIMEOUT_MS = 30000;

  async get<T>(url: string, params?: Record<string, string>): Promise<T> {
    const target = params ? this.withQuery(url, params) : url;
    const { signal, cleanup } = this.withTimeout(undefined, ApiClient.DEFAULT_TIMEOUT_MS);
    try {
      const res = await fetch(target, { signal });
      return this.handleResponse<T>(res);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request to ${target} timed out after ${ApiClient.DEFAULT_TIMEOUT_MS}ms`);
      }
      throw error;
    } finally {
      cleanup();
    }
  }

  async post<T>(url: string, body?: unknown): Promise<T> {
    const init: RequestInit = { method: 'POST' };
    if (body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    const { signal, cleanup } = this.withTimeout(init.signal, ApiClient.DEFAULT_TIMEOUT_MS);
    init.signal = signal;
    try {
      const res = await fetch(url, init);
      return this.handleResponse<T>(res);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request to ${url} timed out after ${ApiClient.DEFAULT_TIMEOUT_MS}ms`);
      }
      throw error;
    } finally {
      cleanup();
    }
  }

  async delete<T>(url: string): Promise<T> {
    const { signal, cleanup } = this.withTimeout(undefined, ApiClient.DEFAULT_TIMEOUT_MS);
    try {
      const res = await fetch(url, { method: 'DELETE', signal });
      return this.handleResponse<T>(res);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request to ${url} timed out after ${ApiClient.DEFAULT_TIMEOUT_MS}ms`);
      }
      throw error;
    } finally {
      cleanup();
    }
  }

  private async handleResponse<T>(res: Response): Promise<T> {
    if (!res.ok) {
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = await res.text().catch(() => null);
      }
      throw new ApiError(res.status, res.statusText, body);
    }

    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  private withTimeout(
    signal?: AbortSignal | null,
    timeoutMs?: number,
  ): { signal: AbortSignal; cleanup: () => void } {
    if (!timeoutMs || timeoutMs <= 0) {
      return {
        signal: signal ?? new AbortController().signal,
        cleanup: () => {},
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let aborted = false;

    const cleanup = () => {
      clearTimeout(timeoutId);
    };

    if (signal) {
      signal.addEventListener('abort', () => {
        if (!aborted) {
          aborted = true;
          controller.abort();
        }
      });
    }

    return { signal: controller.signal, cleanup };
  }

  private withQuery(url: string, params: Record<string, string>): string {
    const qs = new URLSearchParams(params).toString();
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}${qs}`;
  }
}

export const apiClient = new ApiClient();
