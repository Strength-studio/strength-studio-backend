const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export type Settings = { sessionTypeId: string; durationMinutes: number; bufferMinutes: number; groupCapacity: number | null };
export type Coach = { id: string; displayName: string };
export type ScheduledSession = {
  id: string; sessionTypeId: string; sessionTypeName: string; coach: Coach;
  startsAt: string; endsAt: string; bufferMinutes: number; capacity: number; revision: number;
  status: 'SCHEDULED' | 'CANCELLED'; cancelledAt: string | null;
};

export type SchedulingRoute = 'settings' | 'coaches' | 'sessions' | 'my-sessions' | 'created' | 'empty';
export function schedulingRoute(method: string, parts: string[]): SchedulingRoute | null {
  const [family, resource, id, action] = parts;
  if (family !== 'scheduling') return null;
  if (parts.length === 2) {
    if (method === 'GET' && (resource === 'settings' || resource === 'coaches' || resource === 'sessions' || resource === 'my-sessions')) return resource;
    if (method === 'POST' && resource === 'sessions') return 'created';
  }
  if (parts.length === 3 && method === 'PATCH' && (resource === 'sessions' || resource === 'settings') && uuid.test(id)) {
    return 'empty';
  }
  if (parts.length === 4 && method === 'POST' && resource === 'sessions' && uuid.test(id) && action === 'cancel') {
    return 'empty';
  }
  return null;
}

export function schedulingQuery(route: SchedulingRoute, params: URLSearchParams) {
  const result = new URLSearchParams();
  const filters = ['from', 'until', 'limit', 'after'];
  if (route === 'sessions') filters.push('coachId');
  for (const [key, value] of params) {
    if ((route !== 'sessions' && route !== 'my-sessions') || result.has(key) || !value || value.length > 64
      || !filters.includes(key)) return null;
    result.set(key, value);
  }
  return result;
}

type Json = Record<string, unknown>;
const coach = ({ id, displayName }: Json) => ({ id, displayName });

export function schedulingResponse(route: SchedulingRoute, body: unknown) {
  switch (route) {
    case 'settings':
      return (body as Json[]).map(({ sessionTypeId, durationMinutes, bufferMinutes, groupCapacity }) =>
        ({ sessionTypeId, durationMinutes, bufferMinutes, groupCapacity }));
    case 'coaches':
      return (body as Json[]).map(coach);
    case 'sessions':
    case 'my-sessions': {
      const { items, nextCursor } = body as { items: Json[]; nextCursor: unknown };
      return { nextCursor, items: items.map(({ id, sessionTypeId, sessionTypeName, startsAt, endsAt, bufferMinutes,
        capacity, revision, status, cancelledAt, coach: assignment }) =>
        ({ id, sessionTypeId, sessionTypeName, startsAt, endsAt, bufferMinutes, capacity, revision, status, cancelledAt,
          coach: coach(assignment as Json) })) };
    }
    case 'created':
      return { sessionId: (body as Json).sessionId };
    case 'empty':
      return {};
  }
}
