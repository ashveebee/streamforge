import { config } from '../config.js';

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly service?: string,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  timeoutMs?: number;
  service?: string;
}

export function buildUrl(base: string, path: string, query?: RequestOptions['query']) {
  const u = new URL(base + (path.startsWith('/') ? path : `/${path}`));
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined) u.searchParams.set(k, String(v));
  }
  return u.toString();
}

/** Turns low-level fetch failures into something a human can act on. */
function describeNetworkError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'Request timed out';
    const cause = (err as Error & { cause?: { code?: string; message?: string } }).cause;
    if (cause?.code === 'ECONNREFUSED') return 'Connection refused';
    if (cause?.code === 'ENOTFOUND') return 'Host not found';
    if (cause?.code === 'EHOSTUNREACH') return 'Host unreachable';
    if (cause?.code?.startsWith('ERR_TLS') || cause?.code?.includes('CERT'))
      return `TLS error: ${cause.message ?? cause.code}`;
    if (cause?.message) return cause.message;
    return err.message;
  }
  return String(err);
}

export async function requestRaw(url: string, opts: RequestOptions = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...opts.headers,
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? config.requestTimeoutMs),
      redirect: 'follow',
    });
  } catch (err) {
    throw new UpstreamError(describeNetworkError(err), undefined, opts.service);
  }
  return res;
}

export async function requestJson<T>(url: string, opts: RequestOptions = {}): Promise<T> {
  const res = await requestRaw(url, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const detail = text.length && text.length < 300 ? `: ${text}` : '';
    const reason =
      res.status === 401 || res.status === 403 ? 'Unauthorised — check API key' : res.statusText;
    throw new UpstreamError(`HTTP ${res.status} ${reason}${detail}`.trim(), res.status, opts.service);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new UpstreamError('Upstream returned a non-JSON response', res.status, opts.service);
  }
}

/** A small typed client bound to a base URL and a fixed set of auth headers. */
export function createClient(service: string, baseUrl: string, headers: Record<string, string>) {
  return {
    baseUrl,
    get: <T>(path: string, query?: RequestOptions['query']) =>
      requestJson<T>(buildUrl(baseUrl, path, query), { headers, service }),
    post: <T>(path: string, body: unknown, query?: RequestOptions['query']) =>
      requestJson<T>(buildUrl(baseUrl, path, query), { method: 'POST', body, headers, service }),
    put: <T>(path: string, body: unknown, query?: RequestOptions['query']) =>
      requestJson<T>(buildUrl(baseUrl, path, query), { method: 'PUT', body, headers, service }),
    del: <T>(path: string, query?: RequestOptions['query']) =>
      requestJson<T>(buildUrl(baseUrl, path, query), { method: 'DELETE', headers, service }),
    raw: (path: string, query?: RequestOptions['query'], extraHeaders?: Record<string, string>) =>
      requestRaw(buildUrl(baseUrl, path, query), {
        headers: { ...headers, Accept: '*/*', ...extraHeaders },
        service,
      }),
  };
}
export type ServiceClient = ReturnType<typeof createClient>;
