import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

export const accessCookie = '__Host-ss_access';
export const refreshCookie = '__Host-ss_refresh';
const cookieOptions = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' } as const;
const noStore = { 'Cache-Control': 'no-store' };

type TokenPair = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresAt: string;
};

export function reply(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: noStore });
}

export function trustedOrigin(request: NextRequest) {
  const expected = process.env.DASHBOARD_ORIGIN;
  return !!expected && request.headers.get('origin') === expected
    && request.headers.get('host') === new URL(expected).host;
}

export function csrfToken(refresh: string) {
  const key = process.env.DASHBOARD_CSRF_KEY ?? '';
  if (!/^[\da-f]{64}$/i.test(key)) throw new Error('Missing dashboard CSRF key');
  return createHmac('sha256', Buffer.from(key, 'hex')).update(refresh).digest('hex');
}

export function validCsrf(request: NextRequest, refresh: string) {
  const provided = request.headers.get('x-csrf-token') ?? '';
  return /^[\da-f]{64}$/i.test(provided)
    && timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(csrfToken(refresh), 'hex'));
}

export function keepSession(pair: TokenPair) {
  if (typeof pair.accessToken !== 'string' || typeof pair.refreshToken !== 'string'
    || !Number.isInteger(pair.expiresIn) || !Number.isFinite(Date.parse(pair.refreshExpiresAt))) {
    throw new Error('Invalid API token response');
  }
  const response = reply({ ok: true });
  response.cookies.set(accessCookie, pair.accessToken, { ...cookieOptions, maxAge: pair.expiresIn });
  response.cookies.set(refreshCookie, pair.refreshToken, { ...cookieOptions, expires: new Date(pair.refreshExpiresAt) });
  return response;
}

export function clearSession(status = 200) {
  const response = reply(status === 200 ? { ok: true } : { code: 'UNAUTHENTICATED' }, status);
  response.cookies.set(accessCookie, '', { ...cookieOptions, maxAge: 0 });
  response.cookies.set(refreshCookie, '', { ...cookieOptions, maxAge: 0 });
  return response;
}

export async function api(path: string, method: 'GET' | 'POST' | 'PATCH', options: {
  token?: string;
  body?: object;
  query?: URLSearchParams;
  idempotencyKey?: string;
} = {}) {
  const base = new URL(process.env.API_BASE_URL ?? '');
  const local = ['localhost', '127.0.0.1'].includes(base.hostname);
  if (base.origin !== base.href.slice(0, -1) || base.username || base.password
    || (base.protocol !== 'https:' && !(base.protocol === 'http:' && local))) {
    throw new Error('API_BASE_URL must be an HTTPS origin or loopback HTTP origin');
  }
  const url = new URL(base.origin + '/api/v1/' + path);
  if (options.query) url.search = options.query.toString();
  return fetch(url, {
    method, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5000),
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
}
