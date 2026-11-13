import { NextRequest, NextResponse } from 'next/server';
import { catalogBody, catalogError, catalogQuery, catalogResponse, catalogRoute } from '../../../../../lib/catalog-relay';
import { clientQuery, clientRoute, isClientRelayPath, readClientRoute } from '../../../../../lib/client-relay';
import { purchaseFundingRelay } from '../../../../../lib/purchase-funding-relay';
import { accessCookie, api, refreshCookie, reply, trustedOrigin, validCsrf } from '../../../../../lib/session';

type Route = { params: Promise<{ path: string[] }> };

function rejectedClientRequest(parts: string[]) {
  if (!clientRoute('GET', parts)) return reply({ code: 'NOT_FOUND' }, 404);
  const response = reply({ code: 'METHOD_NOT_ALLOWED' }, 405);
  response.headers.set('Allow', 'GET');
  return response;
}

async function forward(request: NextRequest, route: Route, method: 'GET' | 'POST' | 'PATCH') {
  const { path: parts } = await route.params;
  if (parts[0] === 'purchases') return purchaseFundingRelay(request, parts);
  const legacy = method === 'GET' && parts.length === 1 && parts[0] === 'me' ? 'me'
    : method === 'POST' && parts.length === 2 && parts[0] === 'auth' && parts[1] === 'socket-ticket' ? 'auth/socket-ticket' : null;
  const catalog = catalogRoute(method, parts);
  const client = clientRoute(request.method, parts);
  if (isClientRelayPath(parts) && !client) return rejectedClientRequest(parts);
  if (!legacy && !catalog && !client) return reply({ code: 'NOT_FOUND' }, 404);
  const token = request.cookies.get(accessCookie)?.value;
  if (!token) return reply({ code: 'UNAUTHENTICATED' }, 401);
  try {
    if (method !== 'GET') {
      const refresh = request.cookies.get(refreshCookie)?.value;
      if (!trustedOrigin(request) || !refresh || !validCsrf(request, refresh)) return reply({ code: 'CSRF_DENIED' }, 403);
    }
    if (legacy) {
      const result = await api(legacy, method, { token });
      if (!result.ok) return reply({ code: 'API_REQUEST_FAILED' }, result.status);
      const body = await result.json();
      return reply(legacy === 'me' ? { id: body.id, email: body.email, role: body.role }
        : { ticket: body.ticket, expiresAt: body.expiresAt });
    }
    if (client) {
      const query = clientQuery(client, request.nextUrl.searchParams);
      if (!query) return reply({ code: 'INVALID_INPUT' }, 400);
      const result = await readClientRoute(client, parts.join('/'), token, query);
      return result.ok ? reply(result.data) : reply(result.error, result.status);
    }
    if (!catalog) return reply({ code: 'NOT_FOUND' }, 404);
    const query = catalogQuery(catalog, request.nextUrl.searchParams);
    if (!query) return reply({ code: 'INVALID_INPUT' }, 400);
    let options: Parameters<typeof api>[2] = { token, query };
    if (method !== 'GET') {
      const key = request.headers.get('idempotency-key') ?? '';
      if (!/^[a-zA-Z0-9._-]{1,128}$/.test(key)) return reply({ code: 'INVALID_IDEMPOTENCY_KEY' }, 400);
      const payload = await catalogBody(request);
      if ('status' in payload) return reply({ code: payload.status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INVALID_INPUT' }, payload.status);
      options = { token, body: payload.body, idempotencyKey: key };
    }
    const result = await api(parts.join('/'), method, options);
    if (!result.ok) return reply(await catalogError(result), result.status);
    if (result.status === 204) return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
    return reply(catalogResponse(catalog, await result.json()), result.status);
  } catch {
    return reply({ code: 'DASHBOARD_UNAVAILABLE' }, 503);
  }
}

export function GET(request: NextRequest, route: Route) {
  return forward(request, route, 'GET');
}

export function HEAD(request: NextRequest, route: Route) {
  return forward(request, route, 'GET');
}

export async function OPTIONS(request: NextRequest, route: Route) {
  const { path } = await route.params;
  if (path[0] === 'purchases') return purchaseFundingRelay(request, path);
  if (isClientRelayPath(path)) return rejectedClientRequest(path);
  return new NextResponse(null, { status: 204, headers: { Allow: 'GET, HEAD, OPTIONS, PATCH, POST' } });
}

export function POST(request: NextRequest, route: Route) {
  return forward(request, route, 'POST');
}

export function PATCH(request: NextRequest, route: Route) {
  return forward(request, route, 'PATCH');
}

export async function PUT(request: NextRequest, route: Route) {
  const { path } = await route.params;
  if (path[0] === 'purchases') return purchaseFundingRelay(request, path);
  return isClientRelayPath(path) ? rejectedClientRequest(path) : new NextResponse(null, { status: 405 });
}

export const DELETE = PUT;
