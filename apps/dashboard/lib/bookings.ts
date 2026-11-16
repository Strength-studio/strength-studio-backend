import type { Page } from './catalog';
import type { ScheduledSession } from './scheduling';

export const bookingId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export type BookingStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED';
export type Booking = {
  id: string; clientId: string; clientDisplayName: string; scheduledSessionId: string; membershipId: string;
  packageLabel: string | null; status: BookingStatus; createdAt: string; updatedAt: string; requiresReview: boolean;
};
export type BookingSession = Omit<ScheduledSession, 'bufferMinutes' | 'revision' | 'cancelledAt'> & { confirmedBookingCount: number };
export type BookingPage = Page<Booking> & { session: BookingSession };
export type BookingMembership = {
  membershipId: string; packageLabel: string | null; packageKind: 'TIME' | 'SESSION' | null;
  validFrom: string | null; validThrough: string | null; eligible: boolean; reason: string | null;
  initialSessionAllowance: number | null; confirmedCommitments: number | null; remainingCommitments: number | null;
};

type BookingRoute = 'history' | 'choices' | 'create' | 'approve' | 'decision';

export function isBookingPath(parts: string[]) {
  return parts[0] === 'bookings' || (parts[0] === 'clients' && parts[2] === 'booking-memberships');
}

export function bookingRoute(method: string, parts: string[]): BookingRoute | null {
  const [resource, id, action] = parts;
  if (resource === 'bookings' && parts.length === 1) {
    if (method === 'GET') return 'history';
    if (method === 'POST') return 'create';
  }
  if (parts.length !== 3 || !bookingId.test(id)) return null;
  if (method === 'GET' && resource === 'clients' && action === 'booking-memberships') return 'choices';
  if (method !== 'POST' || resource !== 'bookings') return null;
  if (action === 'approve') return 'approve';
  if (action === 'reject' || action === 'cancel') return 'decision';
  return null;
}

export function bookingQuery(route: BookingRoute, input: URLSearchParams) {
  const query = new URLSearchParams();
  for (const [key, value] of input) {
    if (query.has(key) || !(route === 'history' || route === 'choices')) return null;
    if (key === 'scheduledSessionId' && bookingId.test(value)
      || route === 'history' && (key === 'after' && bookingId.test(value) || key === 'limit' && /^(?:[1-9][0-9]?|100)$/.test(value))) {
      query.set(key, value);
    } else return null;
  }
  return (route === 'history' || route === 'choices') && !query.has('scheduledSessionId') ? null : query;
}

export function bookingResponse(route: BookingRoute, body: unknown) {
  if (route === 'history') {
    const { session, items, nextCursor } = body as BookingPage;
    const { id, sessionTypeId, sessionTypeName, coach, startsAt, endsAt, capacity, status, confirmedBookingCount } = session;
    return {
      session: { id, sessionTypeId, sessionTypeName, coach: { id: coach.id, displayName: coach.displayName },
        startsAt, endsAt, capacity, status, confirmedBookingCount },
      items: items.map(row => ({
        id: row.id, clientId: row.clientId, clientDisplayName: row.clientDisplayName, scheduledSessionId: row.scheduledSessionId,
        membershipId: row.membershipId, packageLabel: row.packageLabel, status: row.status, createdAt: row.createdAt,
        updatedAt: row.updatedAt, requiresReview: row.requiresReview,
      })),
      nextCursor,
    };
  }
  if (route === 'choices') {
    return (body as BookingMembership[]).map(({ membershipId, packageLabel, packageKind, validFrom, validThrough, eligible, reason,
      initialSessionAllowance, confirmedCommitments, remainingCommitments }) => ({
      membershipId, packageLabel, packageKind, validFrom, validThrough, eligible, reason,
      initialSessionAllowance, confirmedCommitments, remainingCommitments,
    }));
  }
  if (route === 'create') {
    const { bookingId, status } = body as { bookingId: string; status: BookingStatus };
    return { bookingId, status };
  }
  return {};
}
