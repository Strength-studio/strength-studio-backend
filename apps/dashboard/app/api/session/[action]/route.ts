import { NextRequest } from 'next/server';
import { api, clearSession, csrfToken, keepSession, refreshCookie, reply, trustedOrigin, validCsrf } from '../../../../lib/session';

type Route = { params: Promise<{ action: string }> };

export async function GET(request: NextRequest, { params }: Route) {
  if ((await params).action !== 'csrf') return reply({ code: 'NOT_FOUND' }, 404);
  const refresh = request.cookies.get(refreshCookie)?.value;
  if (!refresh) return reply({ code: 'UNAUTHENTICATED' }, 401);
  try {
    return reply({ csrfToken: csrfToken(refresh) });
  } catch {
    return reply({ code: 'DASHBOARD_UNAVAILABLE' }, 503);
  }
}

async function loginInput(request: NextRequest) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let size = 0;
  let raw = '';
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > 4096) { await reader.cancel(); return null; }
    raw += decoder.decode(chunk.value, { stream: true });
  }
  try {
    const parsed: unknown = JSON.parse(raw + decoder.decode());
    if (!parsed || typeof parsed !== 'object' || !('email' in parsed) || !('password' in parsed)
      || Object.keys(parsed).length !== 2 || typeof parsed.email !== 'string' || typeof parsed.password !== 'string') return null;
    return { email: parsed.email, password: parsed.password };
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest, { params }: Route) {
  const { action } = await params;
  if (!['login', 'refresh', 'logout'].includes(action)) return reply({ code: 'NOT_FOUND' }, 404);
  if (!trustedOrigin(request)) return reply({ code: 'ORIGIN_DENIED' }, 403);
  try {
    if (action === 'login') {
      const body = await loginInput(request);
      if (!body) return reply({ code: 'INVALID_INPUT' }, 400);
      const result = await api('auth/login', 'POST', { body });
      if (!result.ok) return reply({ code: 'SIGN_IN_FAILED' }, result.status);
      return keepSession(await result.json());
    }
    const refreshToken = request.cookies.get(refreshCookie)?.value;
    if (!refreshToken) return action === 'logout' ? clearSession() : clearSession(401);
    if (!validCsrf(request, refreshToken)) return reply({ code: 'CSRF_DENIED' }, 403);
    const result = await api(`auth/${action}`, 'POST', { body: { refreshToken } });
    if (result.status === 401) return clearSession(action === 'logout' ? 200 : 401);
    if (!result.ok) return reply({ code: 'SESSION_REQUEST_FAILED' }, result.status);
    return action === 'logout' ? clearSession() : keepSession(await result.json());
  } catch {
    return reply({ code: 'DASHBOARD_UNAVAILABLE' }, 503);
  }
}
