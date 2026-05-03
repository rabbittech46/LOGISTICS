// ─────────────────────────────────────────────────────────────────────────────
// API client — Fetch wrapper with JWT refresh, retry, idempotency, and timeout
// ─────────────────────────────────────────────────────────────────────────────

import type { ApiError } from './types';
import { getClientPlatform } from './native';
import { getStoredRefreshToken, setStoredRefreshToken } from './native-session';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'https://localhost';
const DEFAULT_TIMEOUT_MS = 30_000;

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Attach an Idempotency-Key header (required for mutating slot operations) */
  idempotencyKey?: string;
  /** Number of retries on network failure (default: 2) */
  retries?: number;
  /** Request timeout in ms (default: 30000) */
  timeout?: number;
}

// ── Token management (in-memory; refresh via cookie or native storage) ─────
let accessToken: string | null = null;
let refreshPromise: Promise<string | null> | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

async function refreshAccessToken(): Promise<string | null> {
  try {
    const refreshToken = await getStoredRefreshToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-client-platform': getClientPlatform(),
    };

    const res = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
      method: 'POST',
      credentials: 'include', // sends httpOnly cookie
      headers,
      body: refreshToken ? JSON.stringify({ refreshToken }) : undefined,
    });
    if (!res.ok) return null;
    const json = await res.json();
    const newToken = json.data?.accessToken;
    if (json.data?.refreshToken) {
      await setStoredRefreshToken(json.data.refreshToken);
    }
    if (newToken) {
      accessToken = newToken;
      return newToken;
    }
    return null;
  } catch {
    return null;
  }
}

async function getValidToken(): Promise<string | null> {
  if (accessToken) return accessToken;
  // Deduplicate concurrent refresh calls
  if (!refreshPromise) {
    refreshPromise = refreshAccessToken().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

// ── Core fetch wrapper ──────────────────────────────────────────────────────
export class ApiRequestError extends Error {
  constructor(
    public statusCode: number,
    public errorBody: ApiError,
  ) {
    super(errorBody.error || `HTTP ${statusCode}`);
    this.name = 'ApiRequestError';
  }
}

export async function apiClient<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { body, idempotencyKey, retries = 2, timeout = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options;
  const url = `${API_BASE}${path}`;
  const isAuthEndpoint = /^\/api\/v1\/auth(?:\/|$)/.test(path);

  const headers: Record<string, string> = {
    'x-client-platform': getClientPlatform(),
    ...(fetchOptions.headers as Record<string, string>),
  };

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }

  if (!isAuthEndpoint) {
    const token = await getValidToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    // Create a fresh AbortController per attempt for timeout
    const controller = new AbortController();
    const timeoutId = timeout > 0 ? setTimeout(() => controller.abort(), timeout) : null;

    // Merge with any caller-provided signal
    const callerSignal = fetchOptions.signal;
    if (callerSignal?.aborted) {
      controller.abort();
    }
    callerSignal?.addEventListener('abort', () => controller.abort(), { once: true });

    const config: RequestInit = {
      ...fetchOptions,
      headers,
      credentials: 'include',
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    };

    try {
      const res = await fetch(url, config);

      // 401 → try token refresh once, then retry
      if (!isAuthEndpoint && res.status === 401 && attempt === 0) {
        const newToken = await refreshAccessToken();
        if (newToken) {
          headers['Authorization'] = `Bearer ${newToken}`;
          const retryRes = await fetch(url, { ...config, headers, signal: controller.signal });
          if (retryRes.ok) {
            return retryRes.status === 204 ? (undefined as T) : await retryRes.json();
          }
          const errorBody = await retryRes.json().catch(() => ({ error: 'Unauthorized' }));
          throw new ApiRequestError(retryRes.status, { ...errorBody, statusCode: retryRes.status });
        }
        const errorBody = await res.json().catch(() => ({ error: 'Unauthorized' }));
        throw new ApiRequestError(401, { ...errorBody, statusCode: 401 });
      }

      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new ApiRequestError(res.status, { ...errorBody, statusCode: res.status });
      }

      if (res.status === 204) return undefined as T;
      return await res.json();
    } catch (err) {
      lastError = err as Error;
      // Never retry on AbortError (user cancel or timeout) or HTTP errors
      if (err instanceof ApiRequestError) throw err;
      if ((err as Error).name === 'AbortError') throw err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1))); // backoff
        continue;
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  throw lastError ?? new Error('Request failed');
}

// ── Convenience methods ─────────────────────────────────────────────────────
export const api = {
  get: <T>(path: string, opts?: RequestOptions) =>
    apiClient<T>(path, { ...opts, method: 'GET' }),

  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    apiClient<T>(path, { ...opts, method: 'POST', body }),

  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    apiClient<T>(path, { ...opts, method: 'PATCH', body }),

  delete: <T>(path: string, opts?: RequestOptions) =>
    apiClient<T>(path, { ...opts, method: 'DELETE' }),
};
