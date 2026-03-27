interface FetchOptions extends RequestInit {
  timeout?: number;
}

interface FetchResult {
  success: boolean;
  data?: any;
  error?: string;
  status: number;
}

export async function fetch_get(url: string, options?: FetchOptions): Promise<FetchResult> {
  try {
    const controller = new AbortController();
    const timeout = options?.timeout ?? 30000;
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const { headers: customHeaders, ...restOptions } = options || {};
    const mergedHeaders = {
      Accept: 'application/json',
      ...customHeaders,
    };

    const response = await fetch(url, {
      method: 'GET',
      headers: mergedHeaders,
      signal: controller.signal,
      ...restOptions,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      return {
        success: false,
        error: errorData.error || errorData.message || `HTTP ${response.status}`,
        status: response.status,
      };
    }

    const data = await response.json();
    return { success: true, data, status: response.status };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: errorMessage, status: 0 };
  }
}

export async function fetch_post(
  url: string,
  body?: any,
  options?: FetchOptions
): Promise<FetchResult> {
  try {
    const controller = new AbortController();
    const timeout = options?.timeout ?? 30000;
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const { headers: customHeaders, ...restOptions } = options || {};
    const mergedHeaders = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...customHeaders,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: mergedHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      ...restOptions,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      return {
        success: false,
        error: errorData.error || errorData.message || `HTTP ${response.status}`,
        status: response.status,
      };
    }

    const data = await response.json();
    return { success: true, data, status: response.status };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: errorMessage, status: 0 };
  }
}
