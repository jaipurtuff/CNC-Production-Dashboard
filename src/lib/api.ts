/**
 * Safe API client utilities
 * Ensures responses are validated as application/json before parsing.
 * Prevents "Unexpected token '<', <!doctype ... is not valid JSON" errors
 * when endpoints return HTML (e.g. during dev-server restart, reverse proxy cold starts, or 404 fallbacks).
 */

export interface ApiResponse<T> {
  data: T | null;
  error?: string;
  status?: number;
}

export async function safeFetchJson<T>(
  url: string,
  options?: RequestInit
): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(url, options);
    const contentType = res.headers.get('content-type') || '';

    // If server returned HTML (e.g. reverse proxy loading screen, Vite index.html fallback, etc.)
    if (!contentType.includes('application/json')) {
      return {
        data: null,
        error: `Expected JSON but received ${contentType.split(';')[0] || 'text/html'}`,
        status: res.status,
      };
    }

    if (!res.ok) {
      try {
        const errorJson = await res.json();
        return {
          data: null,
          error: errorJson.error || errorJson.message || `HTTP ${res.status}`,
          status: res.status,
        };
      } catch {
        return {
          data: null,
          error: `HTTP Error ${res.status}`,
          status: res.status,
        };
      }
    }

    const data = (await res.json()) as T;
    return { data, status: res.status };
  } catch (err: any) {
    // Network drop or fetch aborted
    return {
      data: null,
      error: err?.message || 'Network request failed',
      status: 0,
    };
  }
}
