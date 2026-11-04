import { NextRequest } from 'next/server';
import { accessCookie, api, refreshCookie, reply, trustedOrigin, validCsrf } from '../../../../../lib/session';

type Route = { params: Promise<{ path: string[] }> };

async function forward(request: NextRequest, route: Route, method: 'GET' | 'POST') {
  const path = (await route.params).path.join('/');
  if ((method === 'GET' && path !== 'me') || (method === 'POST' && path !== 'auth/socket-ticket')) {
    return reply({ code: 'NOT_FOUND' }, 404);
  }
  const token = request.cookies.get(accessCookie)?.value;
  if (!token) return reply({ code: 'UNAUTHENTICATED' }, 401);
  try {
    if (method === 'POST') {
      const refresh = request.cookies.get(refreshCookie)?.value;
      if (!trustedOrigin(request) || !refresh || !validCsrf(request, refresh)) return reply({ code: 'CSRF_DENIED' }, 403);
    }
    const result = await api(path, method, { token });
    if (!result.ok) return reply({ code: 'API_REQUEST_FAILED' }, result.status);
    const body = await result.json();
    return reply(path === 'me' ? { id: body.id, email: body.email, role: body.role }
      : { ticket: body.ticket, expiresAt: body.expiresAt });
  } catch {
    return reply({ code: 'DASHBOARD_UNAVAILABLE' }, 503);
  }
}

export function GET(request: NextRequest, route: Route) {
  return forward(request, route, 'GET');
}

export function POST(request: NextRequest, route: Route) {
  return forward(request, route, 'POST');
}
