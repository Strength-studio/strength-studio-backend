import { NextRequest } from 'next/server';
import { catalogBody } from './catalog-relay';
import { fundingStatuses, membershipStatuses, purchaseUuid } from './purchase-funding';
import { accessCookie, api, refreshCookie, reply, trustedOrigin, validCsrf } from './session';

const amount = /^(?:0|[1-9][0-9]{0,14})\.[0-9]{2}$/;
const isAmount = (value: unknown): value is string => typeof value === 'string' && amount.test(value);
const errorCodes = new Map([
  [400, 'INVALID_INPUT'], [401, 'UNAUTHENTICATED'], [403, 'FORBIDDEN'], [404, 'PURCHASE_NOT_FOUND'],
  [429, 'RATE_LIMITED'], [500, 'INTERNAL_ERROR'], [503, 'DASHBOARD_UNAVAILABLE'],
]);

export async function purchaseFundingRelay(request: NextRequest, parts: string[]) {
  if (parts.length !== 3 || parts[2] !== 'funding') return reply({ code: 'NOT_FOUND' }, 404);
  const id = parts[1].toLowerCase();
  if (!purchaseUuid.test(id)) return reply({ code: 'INVALID_INPUT' }, 400);
  if (request.method !== 'GET') {
    const response = reply({ code: 'METHOD_NOT_ALLOWED' }, 405);
    response.headers.set('Allow', 'GET');
    return response;
  }
  const token = request.cookies.get(accessCookie)?.value;
  if (!token) return reply({ code: 'UNAUTHENTICATED' }, 401);
  if (request.nextUrl.search) return reply({ code: 'INVALID_INPUT' }, 400);

  try {
    const response = await api(`purchases/${id}/funding`, 'GET', { token });
    if (!response.ok) {
      const code = errorCodes.get(response.status);
      if (code) return reply({ code }, response.status);
      if (response.status === 409 && (await response.json())?.code === 'PURCHASE_OVERFUNDED') {
        return reply({ code: 'PURCHASE_OVERFUNDED' }, 409);
      }
      return reply({ code: 'DASHBOARD_UNAVAILABLE' }, 503);
    }

    const { purchaseId, currency, purchasePrice, allocatedAmount, remainingAmount, fundingStatus } = await response.json();
    const status = fundingStatuses.find(value => value === fundingStatus);
    if (purchaseId !== id || currency !== 'SAR' || !isAmount(purchasePrice) || !isAmount(allocatedAmount)
      || !isAmount(remainingAmount) || !status) {
      return reply({ code: 'DASHBOARD_UNAVAILABLE' }, 503);
    }
    return reply({ purchaseId, currency, purchasePrice, allocatedAmount, remainingAmount, fundingStatus: status });
  } catch {
    return reply({ code: 'DASHBOARD_UNAVAILABLE' }, 503);
  }
}

const activationErrors = new Map<number, string[]>([
  [400, ['INVALID_INPUT', 'INVALID_IDEMPOTENCY_KEY', 'ACTIVATION_OVERRIDE_REASON_REQUIRED']],
  [409, ['MEMBERSHIP_ALREADY_ACTIVATED', 'MEMBERSHIP_NOT_ELIGIBLE', 'PURCHASE_OVERFUNDED', 'ACTIVATION_OVERRIDE_REQUIRED',
    'PURCHASE_VALIDITY_OUT_OF_RANGE', 'IDEMPOTENCY_KEY_REUSED', 'IDEMPOTENCY_KEY_EXPIRED']],
  [503, ['RETRY_TRANSACTION']],
]);

export async function purchaseMembershipRelay(request: NextRequest, parts: string[]) {
  const id = parts[1].toLowerCase();
  const activating = parts[2] === 'activate-membership';
  const method = activating ? 'POST' : 'GET';
  if (!purchaseUuid.test(id)) return reply({ code: 'INVALID_INPUT' }, 400);
  if (request.method !== method) {
    const response = reply({ code: 'METHOD_NOT_ALLOWED' }, 405);
    response.headers.set('Allow', method);
    return response;
  }
  const token = request.cookies.get(accessCookie)?.value;
  if (!token) return reply({ code: 'UNAUTHENTICATED' }, 401);
  if (request.nextUrl.search) return reply({ code: 'INVALID_INPUT' }, 400);
  try {
    let options: Parameters<typeof api>[2] = { token };
    if (activating) {
      const refresh = request.cookies.get(refreshCookie)?.value;
      if (!trustedOrigin(request) || !refresh || !validCsrf(request, refresh)) return reply({ code: 'CSRF_DENIED' }, 403);
      const key = request.headers.get('idempotency-key') ?? '';
      if (!/^[a-zA-Z0-9._-]{1,128}$/.test(key)) return reply({ code: 'INVALID_IDEMPOTENCY_KEY' }, 400);
      const payload = await catalogBody(request);
      if ('status' in payload) return reply({ code: payload.status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INVALID_INPUT' }, payload.status);
      options = { token, body: payload.body, idempotencyKey: key };
    }
    const response = await api(`purchases/${id}/${parts[2]}`, method, options);
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const code = activationErrors.get(response.status)?.includes(body?.code) ? body.code : errorCodes.get(response.status);
      return code ? reply({ code }, response.status) : reply({ code: 'DASHBOARD_UNAVAILABLE' }, 503);
    }
    if (!activating) {
      const status = membershipStatuses.find(value => value === body?.status);
      const membershipId = body?.membershipId;
      if (!status || (membershipId !== null && !(typeof membershipId === 'string' && purchaseUuid.test(membershipId)))) {
        return reply({ code: 'DASHBOARD_UNAVAILABLE' }, 503);
      }
      return reply({ membershipId, status });
    }

    const { membership, purchaseType, fundingStatus, overrideUsed, overrideReason } = body ?? {};
    const calendarDate = /^\d{4}-\d{2}-\d{2}$/;
    if (!membership || typeof membership.id !== 'string' || !purchaseUuid.test(membership.id)
      || membership.purchaseId !== id || membership.status !== 'ACTIVE' || typeof membership.activatedAt !== 'string'
      || !Number.isFinite(Date.parse(membership.activatedAt))
      || typeof membership.validFrom !== 'string' || !calendarDate.test(membership.validFrom)
      || typeof membership.validThrough !== 'string' || !calendarDate.test(membership.validThrough)
      || (membership.initialSessionAllowance !== null
        && (!Number.isInteger(membership.initialSessionAllowance) || membership.initialSessionAllowance < 1))
      || (purchaseType !== 'COMPLIMENTARY' && purchaseType !== 'POSITIVE_PRICE')
      || !fundingStatuses.includes(fundingStatus) || typeof overrideUsed !== 'boolean'
      || (overrideUsed && typeof overrideReason !== 'string')) {
      return reply({ code: 'DASHBOARD_UNAVAILABLE' }, 503);
    }
    const { id: membershipId, activatedAt, validFrom, validThrough, initialSessionAllowance } = membership;
    return reply({ membership: { id: membershipId, purchaseId: id, status: 'ACTIVE', activatedAt,
      validFrom, validThrough, initialSessionAllowance }, purchaseType, fundingStatus, overrideUsed,
      ...(overrideUsed ? { overrideReason } : {}) });
  } catch {
    return reply({ code: 'DASHBOARD_UNAVAILABLE' }, 503);
  }
}

export function purchaseRelay(request: NextRequest, parts: string[]) {
  if (parts.length === 3 && (parts[2] === 'membership' || parts[2] === 'activate-membership')) {
    return purchaseMembershipRelay(request, parts);
  }
  return purchaseFundingRelay(request, parts);
}
