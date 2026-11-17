import { NextRequest, NextResponse } from 'next/server';
import { attendanceQuery, attendanceResponse, attendanceRoute } from '../../../../../lib/attendance';
import { bookingQuery, bookingResponse, bookingRoute, isBookingPath } from '../../../../../lib/bookings';
import { catalogBody, catalogError, catalogQuery, catalogResponse, catalogRoute } from '../../../../../lib/catalog-relay';
import { clientQuery, clientRoute, isClientRelayPath, readClientRoute } from '../../../../../lib/client-relay';
import { purchaseRelay } from '../../../../../lib/purchase-funding-relay';
import { schedulingQuery, schedulingResponse, schedulingRoute } from '../../../../../lib/scheduling';
import { accessCookie, api, refreshCookie, reply, trustedOrigin, validCsrf } from '../../../../../lib/session';

type Route = { params: Promise<{ path: string[] }> };

function rejectedClientRequest(parts: string[]) {
  if (!clientRoute('GET', parts)) return reply({ code: 'NOT_FOUND' }, 404);
  const response = reply({ code: 'METHOD_NOT_ALLOWED' }, 405);
  response.headers.set('Allow', 'GET');
  return response;
}

function rejectedBookingRequest(parts: string[]) {
  const methods = ['GET', 'POST'].filter(method => bookingRoute(method, parts));
  if (!methods.length) return reply({ code: 'NOT_FOUND' }, 404);
  const response = reply({ code: 'METHOD_NOT_ALLOWED' }, 405);
  response.headers.set('Allow', methods.join(', '));
  return response;
}

function attendanceOrOwnSchedulePath(parts: string[]) {
  return parts[0] === 'attendance' || (parts[0] === 'scheduling' && parts[1] === 'my-sessions');
}

function rejectedAttendanceRequest(parts: string[]) {
  const method = ['GET', 'POST'].find(method => attendanceRoute(method, parts) || schedulingRoute(method, parts) === 'my-sessions');
  if (!method) return reply({ code: 'NOT_FOUND' }, 404);
  const response = reply({ code: 'METHOD_NOT_ALLOWED' }, 405);
  response.headers.set('Allow', method);
  return response;
}

async function forward(request: NextRequest, route: Route, method: 'GET' | 'POST' | 'PATCH') {
  const { path: parts } = await route.params;
  if (parts[0] === 'purchases') return purchaseRelay(request, parts);
  const legacy = method === 'GET' && parts.length === 1 && parts[0] === 'me' ? 'me'
    : method === 'POST' && parts.length === 2 && parts[0] === 'auth' && parts[1] === 'socket-ticket' ? 'auth/socket-ticket' : null;
  const booking = bookingRoute(request.method, parts);
  if (isBookingPath(parts) && !booking) return rejectedBookingRequest(parts);
  const catalog = catalogRoute(method, parts);
  const client = clientRoute(request.method, parts);
  if (!booking && isClientRelayPath(parts) && !client) return rejectedClientRequest(parts);
  const scheduling = parts[0] === 'scheduling' ? schedulingRoute(request.method, parts) : null;
  const attendance = attendanceRoute(request.method, parts);
  if (!attendance && !scheduling && attendanceOrOwnSchedulePath(parts)) return rejectedAttendanceRequest(parts);
  if (!legacy && !catalog && !client && !scheduling && !booking && !attendance) return reply({ code: 'NOT_FOUND' }, 404);
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
    const query = attendance ? attendanceQuery(attendance, request.nextUrl.searchParams)
      : booking ? bookingQuery(booking, request.nextUrl.searchParams)
      : scheduling ? schedulingQuery(scheduling, request.nextUrl.searchParams)
      : catalog ? catalogQuery(catalog, request.nextUrl.searchParams) : null;
    if (!query) return reply({ code: 'INVALID_INPUT' }, 400);
    let options: Parameters<typeof api>[2] = { token, query };
    if (method !== 'GET') {
      const key = request.headers.get('idempotency-key') ?? '';
      if (!/^[a-zA-Z0-9._-]{1,128}$/.test(key)) return reply({ code: 'INVALID_IDEMPOTENCY_KEY' }, 400);
      const payload = await catalogBody(request, booking === 'approve');
      if ('status' in payload) return reply({ code: payload.status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INVALID_INPUT' }, payload.status);
      options = { token, body: payload.body, idempotencyKey: key };
    }
    const result = await api(parts.join('/'), method, options);
    if (!result.ok) return reply(await catalogError(result), result.status);
    if (result.status === 204) return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
    const body = await result.json();
    if (attendance) return reply(attendanceResponse(body), result.status);
    return reply(booking ? bookingResponse(booking, body) : scheduling ? schedulingResponse(scheduling, body) : catalogResponse(catalog!, body), result.status);
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
  if (path[0] === 'purchases') return purchaseRelay(request, path);
  if (attendanceOrOwnSchedulePath(path)) return rejectedAttendanceRequest(path);
  if (isBookingPath(path)) return rejectedBookingRequest(path);
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
  if (path[0] === 'purchases') return purchaseRelay(request, path);
  if (attendanceOrOwnSchedulePath(path)) return rejectedAttendanceRequest(path);
  if (isBookingPath(path)) return rejectedBookingRequest(path);
  return isClientRelayPath(path) ? rejectedClientRequest(path) : new NextResponse(null, { status: 405 });
}

export const DELETE = PUT;
