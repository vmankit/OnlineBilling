const BASE_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const TOKEN_KEY = 'santu.auth.token';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly fields?: Array<{ path: string; message: string }>;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
    fields?: Array<{ path: string; message: string }>,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.fields = fields;
  }
}

export const tokenStore = {
  get: (): string | null => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (token: string): void => {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* private mode */
    }
  },
  clear: (): void => {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* private mode */
    }
  },
};

/** Fired when the server rejects our token, so the app can bounce to login. */
export const SESSION_EXPIRED_EVENT = 'santu:session-expired';

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, query, headers, ...rest } = options;

  const url = new URL(`${BASE_URL}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
  }

  const token = tokenStore.get();
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      ...rest,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // fetch() rejects for both a dead network and an unreachable server.
    // Distinguish them, because "no internet" is wrong and misleading when
    // the shop is online but the API is down.
    if (!navigator.onLine) {
      throw new ApiError(0, 'OFFLINE', 'No internet connection. Check the network and try again.');
    }
    throw new ApiError(
      0,
      'SERVER_UNREACHABLE',
      `Cannot reach the Santu Hardware server at ${BASE_URL}. It may be starting up or stopped.`,
    );
  }

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const err = (payload as { error?: { code: string; message: string; details?: unknown; fields?: never } })
      ?.error;

    if (response.status === 401) {
      tokenStore.clear();
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
    }

    throw new ApiError(
      response.status,
      err?.code ?? 'UNKNOWN',
      err?.message ?? 'Something went wrong. Please try again.',
      err?.details,
      err?.fields,
    );
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query']) => apiRequest<T>(path, { method: 'GET', query }),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),
};

/** Downloads a file the API produces (e.g. the Excel export), sending the login token. */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const token = tokenStore.get();
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new ApiError(response.status, 'DOWNLOAD_FAILED', 'Could not download the file.');
  const name = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
