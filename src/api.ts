import { addLog, type LogSection } from './log';

const JSON_API = 'application/vnd.api+json';

export type ApiType = 'storefront' | 'backend';

export interface ApiTarget {
  label: string;
  url: string;
  proxyPrefix: string;
}

export const API_TARGETS: Record<ApiType, ApiTarget> = {
  storefront: { label: 'Storefront API', url: __GLUE_STOREFRONT_URL__, proxyPrefix: '/glue-storefront' },
  backend: { label: 'Backend API', url: __GLUE_BACKEND_URL__, proxyPrefix: '/glue-backend' },
};

export interface GlueRequestOptions {
  api: ApiType;
  // Storefront API only. The Backend API has no store, so it gets no `Store` header.
  store?: string;
  resourceType?: string;
  attributes?: Record<string, unknown>;
  accessToken?: string;
}

export interface GlueResponse {
  status: number;
  ok: boolean;
  body: any;
}

export async function glueRequest(method: 'GET' | 'POST', path: string, options: GlueRequestOptions): Promise<GlueResponse> {
  const target = API_TARGETS[options.api];
  const headers: Record<string, string> = { Accept: JSON_API };
  let body: string | undefined;

  if (options.api === 'storefront' && options.store) {
    headers.Store = options.store;
  }

  if (options.resourceType) {
    headers['Content-Type'] = JSON_API;
    body = JSON.stringify({ data: { type: options.resourceType, attributes: options.attributes ?? {} } });
  }

  if (options.accessToken) {
    headers.Authorization = `Bearer ${options.accessToken}`;
  }

  const request: LogSection = {
    label: 'Request',
    content: {
      api: target.label,
      url: target.url + path,
      sentVia: `${location.origin}${target.proxyPrefix}${path} (dev-server proxy)`,
      headers: options.accessToken ? { ...headers, Authorization: `Bearer ${shorten(options.accessToken)}` } : headers,
      ...(body !== undefined && { body: JSON.parse(body) }),
    },
  };
  const startedAt = performance.now();
  let response: Response;

  try {
    response = await fetch(target.proxyPrefix + path, { method, headers, body });
  } catch (error) {
    addLog({
      kind: 'http',
      method,
      title: `${target.label} ${path}`,
      status: 0,
      durationMs: elapsedSince(startedAt),
      sections: [request, { label: 'Error', content: String(error) }],
    });

    return { status: 0, ok: false, body: null };
  }

  const text = await response.text();
  const parsed = parseJson(text);

  addLog({
    kind: 'http',
    method,
    title: `${target.label} ${path}`,
    status: response.status,
    durationMs: elapsedSince(startedAt),
    sections: [
      request,
      { label: 'Response body', content: parsed ?? (text || '(empty)') },
      { label: 'Response headers', content: Object.fromEntries(response.headers), open: false },
    ],
  });

  return { status: response.status, ok: response.ok, body: parsed };
}

export function errorMessage(response: GlueResponse): string {
  if (response.status === 0) {
    return 'The API is not reachable. Make sure that the Spryker environment runs.';
  }

  const errors: Array<{ code?: string; detail?: string; message?: string }> =
    response.body?.errors ?? (Array.isArray(response.body) ? response.body : []);
  const messages = errors.map((error) => [error.code, error.detail ?? error.message].filter(Boolean).join(': '));

  return messages.length > 0 ? `HTTP ${response.status}: ${messages.join('; ')}` : `HTTP ${response.status}`;
}

function parseJson(text: string): unknown {
  try {
    return text === '' ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

function shorten(token: string): string {
  return token.length > 24 ? `${token.slice(0, 20)}…` : token;
}

function elapsedSince(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}
