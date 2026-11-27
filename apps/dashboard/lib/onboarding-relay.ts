import { NextRequest, NextResponse } from 'next/server';
import { catalogBody } from './catalog-relay';
import { accessCookie, api, refreshCookie, reply, trustedOrigin, validCsrf } from './session';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function onboardingRoute(method: string, p: string[]) {
  if (method === 'POST' && p.join('/') === 'users/invite') return 'invite';
  if (method === 'GET' && p.length === 3 && p[0] === 'clients' && uuid.test(p[1]) && p[2] === 'onboarding') return 'status';
  if (method === 'POST' && p.length === 4 && p[0] === 'users' && uuid.test(p[1]) && p[2] === 'onboarding'
    && ['reissue', 'revoke'].includes(p[3])) return p[3];
  return null;
}
export async function onboardingRelay(request: NextRequest, parts: string[]) {
  const route = onboardingRoute(request.method, parts);
  if (!route) return reply({ code: 'NOT_FOUND' }, 404);
  const token = request.cookies.get(accessCookie)?.value;
  if (!token) return reply({ code: 'UNAUTHENTICATED' }, 401);
  try {
    if (request.nextUrl.search) return reply({ code: 'INVALID_INPUT' }, 400);
    if (route !== 'status') {
      const refresh = request.cookies.get(refreshCookie)?.value;
      if (!trustedOrigin(request) || !refresh || !validCsrf(request, refresh)) return reply({ code: 'CSRF_DENIED' }, 403);
    }
    const identity = await api('me', 'GET', { token });
    if (!identity.ok) return reply({ code: identity.status === 401 ? 'UNAUTHENTICATED' : 'DASHBOARD_UNAVAILABLE' }, identity.status === 401 ? 401 : 503);
    const actor = await identity.json();
    if (actor.role !== 'ADMIN') return reply({ code: 'FORBIDDEN' }, 403);
    let body: object | undefined, key: string | undefined;
    if (route !== 'status') {
      if (request.headers.get('x-studio-actor') !== actor.id) return reply({ code: 'FORBIDDEN' }, 403);
      key = request.headers.get('idempotency-key') ?? '';
      if (!/^[A-Za-z0-9._-]{1,128}$/.test(key)) return reply({ code: 'INVALID_IDEMPOTENCY_KEY' }, 400);
      const input = await catalogBody(request);
      if ('status' in input) return reply({ code: 'INVALID_INPUT' }, input.status);
      const data = input.body as Record<string, unknown>;
      if (Object.keys(data).length !== 2 || (route === 'invite'
        ? typeof data.email !== 'string' || typeof data.displayName !== 'string'
        : !Number.isInteger(data.expectedRevision) || typeof data.reason !== 'string')) return reply({ code: 'INVALID_INPUT' }, 400);
      body = input.body;
    }
    const response = await api(parts.join('/'), route === 'status' ? 'GET' : 'POST', { token, body, idempotencyKey: key });
    if (response.status === 204) return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
    const result = await response.json();
    if (!response.ok) {
      const codes = new Set(['CLIENT_IDENTITY_CONFLICT', 'ONBOARDING_CHANGED', 'ONBOARDING_NOT_ELIGIBLE', 'ONBOARDING_RATE_LIMITED',
        'INVALID_INPUT', 'INVALID_IDEMPOTENCY_KEY', 'IDEMPOTENCY_KEY_REUSED', 'IDEMPOTENCY_KEY_EXPIRED', 'UNAUTHENTICATED', 'FORBIDDEN',
        'CLIENT_NOT_FOUND', 'CLIENT_ONBOARDING_NOT_FOUND', 'ONBOARDING_UNAVAILABLE', 'RETRY_TRANSACTION', 'RATE_LIMITED']);
      return reply({ code: codes.has(result.code) ? result.code : 'DASHBOARD_UNAVAILABLE' }, response.status);
    }
    if (route === 'status') return reply({ status: result.status, revision: result.revision,
      expiresAt: result.expiresAt, canReissueAt: result.canReissueAt, delivery: result.delivery });
    if (!uuid.test(result.clientId) || !uuid.test(result.challengeId) || !Number.isFinite(Date.parse(result.expiresAt))) throw new Error('Invalid response');
    if (result.setupLink) {
      const link = new URL(result.setupLink);
      if (link.origin !== process.env.DASHBOARD_ORIGIN || link.pathname !== '/setup' || link.search
        || !/^#token=[A-Za-z0-9_-]{43}$/.test(link.hash)) throw new Error('Invalid disclosure');
    }
    return reply({ clientId: result.clientId, challengeId: result.challengeId, expiresAt: result.expiresAt,
      linkAvailable: result.linkAvailable === true, ...(result.setupLink ? { setupLink: result.setupLink } : {}) }, response.status);
  } catch { return reply({ code: 'DASHBOARD_UNAVAILABLE' }, 503); }
}
