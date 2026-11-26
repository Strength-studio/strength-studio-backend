import { NextRequest } from 'next/server';
import { catalogBody } from './catalog-relay';
import { accessCookie, api, refreshCookie, reply, trustedOrigin, validCsrf } from './session';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const amount = /^(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,2})?$/;
const methods = new Set(['CASH', 'BANK_TRANSFER', 'MADA', 'STC_PAY']);
const agreementMethods = new Set(['SIGNED_AGREEMENT', 'VERBAL_AGREEMENT']);
const conflictCodes = new Set(['POSITIVE_PRICE_ACCEPTANCE_EXISTS', 'CATALOG_VERSION_NOT_ELIGIBLE', 'CLIENT_NOT_ACTIVE', 'IDEMPOTENCY_KEY_REUSED', 'IDEMPOTENCY_KEY_EXPIRED', 'PAYMENT_INTAKE_EXISTS', 'PAYMENT_NOT_UNVERIFIED', 'PAYMENT_NOT_VERIFIED', 'PAYMENT_PURCHASE_CLIENT_MISMATCH', 'PAYMENT_ALLOCATION_EXCEEDS_AVAILABLE', 'PAYMENT_ALLOCATION_EXCEEDS_PURCHASE_PRICE']);
const errors = new Map([
  [400, 'INVALID_INPUT'], [401, 'UNAUTHENTICATED'], [403, 'FORBIDDEN'], [404, 'RESOURCE_NOT_FOUND'],
  [409, 'COMMERCIAL_CONFLICT'], [413, 'PAYLOAD_TOO_LARGE'], [429, 'RATE_LIMITED'],
  [500, 'INTERNAL_ERROR'], [503, 'DASHBOARD_UNAVAILABLE'],
]);

function validBody(path: string[], body: Record<string, unknown>) {
  if (path.join('/') === 'purchases/positive-price') {
    if (Object.keys(body).some(key => !['clientId','packageId','packageVersionId','agreementMethod','agreementEvidence','purpose'].includes(key))) return false;
    return uuid.test(String(body.clientId)) && uuid.test(String(body.packageId)) && uuid.test(String(body.packageVersionId))
      && agreementMethods.has(String(body.agreementMethod)) && typeof body.agreementEvidence === 'string'
      && body.agreementEvidence.trim().length > 0 && body.agreementEvidence.length <= 2000
      && typeof body.purpose === 'string' && body.purpose.trim().length > 0 && body.purpose.length <= 240;
  }
  if (path.join('/') === 'payments') {
    if (Object.keys(body).some(key => !['clientId','intakeId','amount','currency','method','receivedAt','reference','evidence'].includes(key))) return false;
    if (body.reference !== undefined && (typeof body.reference !== 'string' || body.reference.length > 200)) return false;
    if (body.evidence !== undefined && (typeof body.evidence !== 'string' || body.evidence.length > 2000)) return false;
    return uuid.test(String(body.clientId)) && uuid.test(String(body.intakeId)) && typeof body.amount === 'string'
      && amount.test(body.amount) && !/^0(?:\.0+)?$/.test(body.amount) && body.currency === 'SAR'
      && methods.has(String(body.method)) && typeof body.receivedAt === 'string'
      && Number.isFinite(Date.parse(body.receivedAt));
  }
  if (path.length === 3 && path[0] === 'payments' && path[2] === 'verify') return Object.keys(body).length === 0;
  if (path.length === 3 && path[0] === 'payments' && path[2] === 'allocations') {
    if (Object.keys(body).some(key => !['purchaseId','amount'].includes(key))) return false;
    return uuid.test(String(body.purchaseId)) && typeof body.amount === 'string' && amount.test(body.amount) && !/^0(?:\.0+)?$/.test(body.amount);
  }
  return false;
}

export async function commercialRelay(request: NextRequest, parts: string[]) {
  const path = parts.join('/');
  const allowed = path === 'purchases/positive-price' || path === 'payments'
    || (parts[0] === 'payments' && parts.length === 3 && uuid.test(parts[1])
      && (parts[2] === 'verify' || parts[2] === 'allocations'));
  if (!allowed) return reply({ code: 'NOT_FOUND' }, 404);
  if (request.method !== 'POST') {
    const response = reply({ code: 'METHOD_NOT_ALLOWED' }, 405);
    response.headers.set('Allow', 'POST');
    return response;
  }
  const token = request.cookies.get(accessCookie)?.value;
  const refresh = request.cookies.get(refreshCookie)?.value;
  if (!token) return reply({ code: 'UNAUTHENTICATED' }, 401);
  if (!trustedOrigin(request) || !refresh || !validCsrf(request, refresh)) return reply({ code: 'CSRF_DENIED' }, 403);
  if (request.nextUrl.search) return reply({ code: 'INVALID_INPUT' }, 400);
  const key = request.headers.get('idempotency-key') ?? '';
  if (!/^[a-zA-Z0-9._-]{1,128}$/.test(key)) return reply({ code: 'INVALID_IDEMPOTENCY_KEY' }, 400);
  const parsed = await catalogBody(request);
  if ('status' in parsed) return reply({ code: parsed.status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INVALID_INPUT', }, parsed.status);
  if (!validBody(parts, parsed.body as Record<string, unknown>)) return reply({ code: 'INVALID_INPUT' }, 400);
  try {
    const identity = await api('me', 'GET', { token });
    if (!identity.ok) return reply({ code: identity.status === 401 ? 'UNAUTHENTICATED' : 'DASHBOARD_UNAVAILABLE' }, identity.status === 401 ? 401 : 503);
    if ((await identity.json())?.role !== 'ADMIN') return reply({ code: 'FORBIDDEN' }, 403);
    const response = await api(path, 'POST', { token, body: parsed.body, idempotencyKey: key });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const code = errors.get(response.status);
      return reply({ code: response.status === 409 && conflictCodes.has(body?.code) ? body.code : code ?? 'DASHBOARD_UNAVAILABLE',
        ...(typeof body?.requestId === 'string' && uuid.test(body.requestId) ? { requestId: body.requestId } : {}) }, code ? response.status : 503);
    }
    if (path === 'purchases/positive-price') {
      if (!body || !uuid.test(body.purchaseId)) return reply({ code: 'DASHBOARD_UNAVAILABLE' }, 503);
      return reply({ purchaseId: body.purchaseId }, response.status);
    }
    if (path === 'payments') {
      if (!body || !uuid.test(body.paymentId) || body.status !== 'UNVERIFIED') return reply({ code: 'DASHBOARD_UNAVAILABLE' }, 503);
      return reply({ paymentId: body.paymentId, status: body.status }, response.status);
    }
    if (parts[2] === 'verify') {
      if (!body || body.paymentId !== parts[1].toLowerCase() || body.status !== 'VERIFIED') return reply({ code: 'DASHBOARD_UNAVAILABLE' }, 503);
      return reply({ paymentId: body.paymentId, status: body.status }, response.status);
    }
    if (!body || !uuid.test(body.allocationId) || body.paymentId !== parts[1].toLowerCase()
      || body.purchaseId !== String((parsed.body as Record<string, unknown>).purchaseId).toLowerCase() || typeof body.amount !== 'string' || !amount.test(body.amount) || body.currency !== 'SAR') {
      return reply({ code: 'DASHBOARD_UNAVAILABLE' }, 503);
    }
    return reply({ allocationId: body.allocationId, paymentId: body.paymentId, purchaseId: body.purchaseId,
      amount: body.amount, currency: body.currency }, response.status);
  } catch {
    return reply({ code: 'DASHBOARD_UNAVAILABLE' }, 503);
  }
}
