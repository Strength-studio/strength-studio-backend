import { NextRequest } from 'next/server';
import { fundingStatuses, purchaseUuid } from './purchase-funding';
import { accessCookie, api, reply } from './session';

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
