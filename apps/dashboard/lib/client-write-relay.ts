import { NextRequest, NextResponse } from 'next/server';
import { catalogBody } from './catalog-relay';
import { readClientRoute } from './client-relay';
import { accessCookie, api, refreshCookie, reply, trustedOrigin, validCsrf } from './session';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function clientWriteRoute(method: string, parts: string[]) {
  if (method === 'PATCH' && parts.length === 2 && parts[0] === 'clients' && uuid.test(parts[1])) return 'profile';
  if (method === 'POST' && parts.length === 3 && parts[0] === 'users' && uuid.test(parts[1]) && parts[2] === 'disable') return 'disable';
  return null;
}

export function rejectedClientWrite(parts: string[]) {
  const methods = ['GET', 'PATCH'].filter(method => method === 'GET'
    ? parts.length === 2 && parts[0] === 'clients' && uuid.test(parts[1]) : clientWriteRoute(method, parts));
  if (clientWriteRoute('POST', parts)) methods.push('POST');
  if (!methods.length) return reply({ code: 'NOT_FOUND' }, 404);
  const response = reply({ code: 'METHOD_NOT_ALLOWED' }, 405);
  response.headers.set('Allow', methods.join(', '));
  return response;
}

const errors = new Set(['CLIENT_PROFILE_CHANGED', 'CLIENT_NOT_FOUND', 'USER_NOT_FOUND', 'FORBIDDEN', 'UNAUTHENTICATED',
  'INVALID_INPUT', 'INVALID_IDEMPOTENCY_KEY', 'IDEMPOTENCY_KEY_REUSED', 'IDEMPOTENCY_KEY_EXPIRED', 'RETRY_TRANSACTION', 'RATE_LIMITED']);

export async function clientWriteRelay(request: NextRequest, parts: string[]) {
  const route = clientWriteRoute(request.method, parts);
  if (!route) return rejectedClientWrite(parts);
  const token = request.cookies.get(accessCookie)?.value;
  if (!token) return reply({ code: 'UNAUTHENTICATED' }, 401);
  try {
    const refresh = request.cookies.get(refreshCookie)?.value;
    if (!trustedOrigin(request) || !refresh || !validCsrf(request, refresh)) return reply({ code: 'CSRF_DENIED' }, 403);
    if (request.nextUrl.search) return reply({ code: 'INVALID_INPUT' }, 400);
    const key = request.headers.get('idempotency-key') ?? '';
    if (!/^[a-zA-Z0-9._-]{1,128}$/.test(key)) return reply({ code: 'INVALID_IDEMPOTENCY_KEY' }, 400);
    const actor = request.headers.get('x-studio-actor') ?? '';
    if (!uuid.test(actor)) return reply({ code: 'INVALID_INPUT' }, 400);
    const payload = await catalogBody(request);
    if ('status' in payload) return reply({ code: payload.status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INVALID_INPUT' }, payload.status);
    const body = payload.body as Record<string, unknown>;
    if (route === 'profile' ? Object.keys(body).length !== 2 || typeof body.displayName !== 'string'
      || !/^[^\u0000-\u001f\u007f]{1,120}$/.test(body.displayName.trim()) || typeof body.expectedDisplayName !== 'string'
      : Object.keys(body).length !== 0) return reply({ code: 'INVALID_INPUT' }, 400);
    const identity = await api('me', 'GET', { token });
    if (!identity.ok) return reply({ code: identity.status === 401 ? 'UNAUTHENTICATED' : 'DASHBOARD_UNAVAILABLE' }, identity.status === 401 ? 401 : 503);
    const account = await identity.json();
    if (account.role !== 'ADMIN' || account.id !== actor) return reply({ code: 'FORBIDDEN' }, 403);
    if (route === 'disable') {
      const target = await readClientRoute('detail', 'clients/' + parts[1], token, new URLSearchParams());
      if (!target.ok) return reply(target.error, target.status);
    }
    const response = await api(parts.join('/'), request.method as 'PATCH' | 'POST', { token, body, idempotencyKey: key });
    if (response.status === 204) return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
    const error = await response.json().catch(() => null);
    if (!response.ok && [400, 401, 403, 404, 409, 413, 429].includes(response.status)) {
      return reply({ code: errors.has(error?.code) ? error.code : 'API_REQUEST_FAILED',
        ...(typeof error?.requestId === 'string' && uuid.test(error.requestId) ? { requestId: error.requestId } : {}) }, response.status);
    }
    return reply({ code: 'DASHBOARD_UNAVAILABLE' }, 503);
  } catch { return reply({ code: 'DASHBOARD_UNAVAILABLE' }, 503); }
}
