import { bookingId } from './bookings';
import type { Page } from './catalog';
import type { Coach } from './scheduling';

export type AttendanceItem = {
  bookingId: string;
  clientDisplayName: string;
  bookingStatus: 'CONFIRMED' | 'CANCELLED';
  revision: number;
  outcome: 'ATTENDED' | null;
  reviewStatus: 'UNSUBMITTED' | 'PENDING_REVIEW' | 'RETURNED';
  submittedAt: string | null;
};

export type AttendanceDetail = Page<AttendanceItem> & {
  session: {
    id: string;
    sessionTypeId: string;
    sessionTypeName: string;
    coach: Coach;
    startsAt: string;
    endsAt: string;
    revision: number;
    cancelledAt: string | null;
    served: { coachId: string; coachDisplayName: string; startsAt: string; sessionTypeId: string; sessionTypeName: string } | null;
  };
  serverTime: string;
  submissionEnabled: boolean;
  returnEnabled: boolean;
};

export type AttendanceHistory = Page<{
  id: string;
  revision: number;
  outcome: 'ATTENDED';
  submissionKind: 'ORIGINAL' | 'REAFFIRMATION';
  submittedById: string;
  submittedAt: string;
  reviewDecision: { id: string; adminId: string; decision: 'RETURNED'; reason: string; decidedAt: string } | null;
}> & { bookingId: string };

type AttendanceRoute = 'detail' | 'submit' | 'history' | 'return' | 'reaffirm';

export function attendanceRoute(method: string, parts: string[]): AttendanceRoute | null {
  const [resource, collection, id, action] = parts;
  if (resource !== 'attendance' || collection !== 'sessions' || !id || !bookingId.test(id)) return null;
  if (parts.length === 3 && method === 'GET') return 'detail';
  if (parts.length === 4 && method === 'POST' && action === 'submit') return 'submit';
  if (action === 'participants' && parts[4] && bookingId.test(parts[4])) {
    if (parts.length === 5 && method === 'GET') return 'history';
    if (parts.length === 6 && method === 'POST' && (parts[5] === 'return' || parts[5] === 'reaffirm')) return parts[5];
  }
  return null;
}

export function attendanceQuery(route: AttendanceRoute, input: URLSearchParams) {
  const query = new URLSearchParams();
  for (const [key, value] of input) {
    if ((route !== 'detail' && route !== 'history') || query.has(key)) return null;
    if (!(key === 'after' && bookingId.test(value) || key === 'limit' && /^(?:[1-9][0-9]?|100)$/.test(value))) return null;
    query.set(key, value);
  }
  return query;
}

export function attendanceResponse(body: unknown): AttendanceDetail {
  const { session, items, nextCursor, serverTime, submissionEnabled, returnEnabled } = body as AttendanceDetail;
  const { id, sessionTypeId, sessionTypeName, coach, startsAt, endsAt, revision, cancelledAt, served } = session;
  return {
    session: {
      id, sessionTypeId, sessionTypeName, coach: { id: coach.id, displayName: coach.displayName },
      startsAt, endsAt, revision, cancelledAt,
      served: served ? {
        coachId: served.coachId, coachDisplayName: served.coachDisplayName, startsAt: served.startsAt,
        sessionTypeId: served.sessionTypeId, sessionTypeName: served.sessionTypeName,
      } : null,
    },
    serverTime, submissionEnabled, returnEnabled, nextCursor,
    items: items.map(({ bookingId, clientDisplayName, bookingStatus, revision, outcome, reviewStatus, submittedAt }) =>
      ({ bookingId, clientDisplayName, bookingStatus, revision, outcome, reviewStatus, submittedAt })),
  };
}

export function attendanceHistoryResponse(body: unknown): AttendanceHistory {
  const { bookingId, items, nextCursor } = body as AttendanceHistory;
  return { bookingId, nextCursor, items: items.map(({ id, revision, outcome, submissionKind, submittedById, submittedAt, reviewDecision }) => ({
    id, revision, outcome, submissionKind, submittedById, submittedAt,
    reviewDecision: reviewDecision ? {
      id: reviewDecision.id, adminId: reviewDecision.adminId, decision: reviewDecision.decision,
      reason: reviewDecision.reason, decidedAt: reviewDecision.decidedAt,
    } : null,
  })) };
}
