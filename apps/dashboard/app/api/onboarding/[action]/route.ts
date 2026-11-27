import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { NextRequest } from 'next/server';
import { catalogBody } from '../../../../lib/catalog-relay';
import { api, reply, trustedOrigin } from '../../../../lib/session';

const nonceCookie = '__Host-ss_onboarding_nonce', passwordCookie = '__Host-ss_password_setup';
const options = { httpOnly: true, secure: true, sameSite: 'strict', path: '/' } as const;
type Route = { params: Promise<{ action: string }> };
function signature(value: string) {
  const key = process.env.DASHBOARD_CSRF_KEY ?? '';
  if (!/^[0-9a-f]{64}$/i.test(key)) throw new Error('CSRF key unavailable');
  return createHmac('sha256', Buffer.from(key, 'hex')).update('onboarding:' + value).digest('hex');
}
function valid(value: string) {
  if (!/^\d{13}\.[A-Za-z0-9_-]{32}\.[a-f0-9]{64}$/.test(value)) return false;
  const [time, random, mac] = value.split('.'), age = Date.now() - Number(time);
  return age >= 0 && age < 900_000 && timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(signature(time + '.' + random), 'hex'));
}
export async function GET(request: NextRequest, { params }: Route) {
  if ((await params).action !== 'csrf' || request.nextUrl.search) return reply({ code: 'NOT_FOUND' }, 404);
  try {
    let nonce = request.cookies.get(nonceCookie)?.value ?? '';
    if (!valid(nonce)) { const value = Date.now() + '.' + randomBytes(24).toString('base64url'); nonce = value + '.' + signature(value); }
    const response = reply({ csrfToken: nonce });
    response.cookies.set(nonceCookie, nonce, { ...options, maxAge: 900 });
    return response;
  } catch { return reply({ code: 'DASHBOARD_UNAVAILABLE' }, 503); }
}
export async function POST(request: NextRequest, { params }: Route) {
  const { action } = await params;
  if (!['accept', 'verify', 'password', 'resend'].includes(action)) return reply({ code: 'NOT_FOUND' }, 404);
  if (!trustedOrigin(request) || request.nextUrl.search) return reply({ code: 'ORIGIN_DENIED' }, 403);
  try {
    const nonce = request.cookies.get(nonceCookie)?.value ?? '';
    if (!valid(nonce) || request.headers.get('x-onboarding-csrf') !== nonce) return reply({ code: 'CSRF_DENIED' }, 403);
    const input = await catalogBody(request);
    if ('status' in input) return reply({ code: 'INVALID_INPUT' }, input.status);
    const data = input.body as Record<string, unknown>;
    const field = action === 'password' ? 'password' : action === 'resend' ? 'email' : 'token';
    if (Object.keys(data).length !== (action === 'password' ? 2 : 1) || typeof data[field] !== 'string'
      || (action === 'password' && typeof data.flowId !== 'string')) {
      return reply({ code: 'INVALID_INPUT' }, 400);
    }
    const path = ({ accept: 'accept-invitation', verify: 'verify-email', password: 'setup-password', resend: 'resend-verification' })[action]!;
    const authorization = request.cookies.get(passwordCookie)?.value ?? '';
    const [flowId, passwordToken] = authorization.split('.');
    // A different tab may have replaced the browser-wide authorization. Never
    // forward its credential or clear its cookie when this form belongs elsewhere.
    if (action === 'password' && (!/^[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{43}$/.test(authorization) || flowId !== data.flowId)) {
      return reply({ code: 'CHALLENGE_INVALID_OR_EXPIRED' }, 400);
    }
    const result = await api('auth/' + path, 'POST', { body: action === 'password' ? { token: passwordToken, password: data.password } : data });
    const body = result.status === 204 ? null : await result.json();
    if (!result.ok) {
      const code = ['INVALID_INPUT', 'CHALLENGE_INVALID_OR_EXPIRED', 'RATE_LIMITED', 'AUTH_BUSY', 'ONBOARDING_UNAVAILABLE', 'RETRY_TRANSACTION'].includes(body?.code)
        ? body.code : 'DASHBOARD_UNAVAILABLE';
      const response = reply({ code }, result.status);
      if (action === 'password' && code === 'CHALLENGE_INVALID_OR_EXPIRED') response.cookies.set(passwordCookie, '', { ...options, maxAge: 0 });
      return response;
    }
    if (action === 'verify') {
      if (!/^[A-Za-z0-9_-]{43}$/.test(body.token) || !Number.isFinite(Date.parse(body.expiresAt))) throw new Error('Invalid authorization');
      const flowId = randomBytes(24).toString('base64url');
      const response = reply({ verified: true, flowId });
      response.cookies.set(passwordCookie, flowId + '.' + body.token, { ...options, expires: new Date(body.expiresAt) });
      return response;
    }
    const response = reply(action === 'password' ? { completed: true } : { accepted: true }, result.status === 202 ? 202 : 200);
    // Generic resend acknowledgement says nothing about issuance. The backend
    // remains authoritative for supersession; a no-op must preserve this cookie.
    if (action === 'password') response.cookies.set(passwordCookie, '', { ...options, maxAge: 0 });
    return response;
  } catch { return reply({ code: 'DASHBOARD_UNAVAILABLE' }, 503); }
}
