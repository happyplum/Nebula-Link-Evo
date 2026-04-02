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
  async get<T>(url: string, params?: Record<string, string>): Promise<T> {
    const target = params ? this.withQuery(url, params) : url;
    const res = await fetch(target);
    return this.handleResponse<T>(res);
  }

  async post<T>(url: string, body?: unknown): Promise<T> {
    const init: RequestInit = { method: 'POST' };
    if (body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    const res = await fetch(url, init);
    return this.handleResponse<T>(res);
  }

  async delete<T>(url: string): Promise<T> {
    const res = await fetch(url, { method: 'DELETE' });
    return this.handleResponse<T>(res);
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

  private withQuery(url: string, params: Record<string, string>): string {
    const qs = new URLSearchParams(params).toString();
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}${qs}`;
  }
}

export const apiClient = new ApiClient();
