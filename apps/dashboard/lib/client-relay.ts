import { api } from './session';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const cursor = /^[A-Za-z0-9_-]{48}$/;
export const clientStates = ['INVITED', 'PENDING_VERIFICATION', 'ACTIVE', 'DISABLED'] as const;
type ClientState = typeof clientStates[number];

function clientState(value: unknown): value is ClientState {
  return clientStates.some(state => state === value);
}

export function isClientRelayPath(parts: string[]) {
  return parts[0] === 'clients' || (parts[0] === 'me' && parts[1] === 'client-profile');
}

export function clientRoute(method: string, parts: string[]) {
  if (method !== 'GET') return null;
  if (parts.length === 1 && parts[0] === 'clients') return 'list';
  if (parts.length !== 2) return null;
  if (parts[0] === 'clients' && uuid.test(parts[1])) return 'detail';
  if (parts[0] === 'me' && parts[1] === 'client-profile') return 'self';
  return null;
}

type ClientRoute = NonNullable<ReturnType<typeof clientRoute>>;

export function clientQuery(route: ClientRoute, input: URLSearchParams) {
  const query = new URLSearchParams();
  for (const [name, value] of input) {
    if (route !== 'list' || query.has(name)) return null;
    const valid = name === 'limit' && /^(?:[1-9][0-9]?|100)$/.test(value)
      || name === 'after' && cursor.test(value)
      || name === 'q' && /^[^\u0000-\u001f\u007f]{1,120}$/.test(value.trim())
      || name === 'accountState' && clientState(value)
      || name === 'emailVerified' && (value === 'true' || value === 'false');
    if (!valid) return null;
    query.set(name, name === 'q' ? value.trim() : value);
  }
  return query;
}

function record(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Client response');
  return value as Record<string, unknown>;
}

function profile(value: unknown) {
  const { id, displayName, email } = record(value);
  if (typeof id !== 'string' || !uuid.test(id) || typeof displayName !== 'string' || typeof email !== 'string') {
    throw new Error('Invalid Client profile');
  }
  return { id, displayName, email };
}

function dateTime(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function directoryItem(value: unknown) {
  const { accountState, emailVerified, createdAt } = record(value);
  if (!clientState(accountState) || typeof emailVerified !== 'boolean' || !dateTime(createdAt)) {
    throw new Error('Invalid Client directory item');
  }
  return { ...profile(value), accountState, emailVerified, createdAt };
}

function detail(value: unknown) {
  const { emailVerifiedAt } = record(value);
  if (emailVerifiedAt !== null && !dateTime(emailVerifiedAt)) throw new Error('Invalid Client verification date');
  return { ...directoryItem(value), emailVerifiedAt };
}

function directory(value: unknown, query: URLSearchParams) {
  const { items, nextCursor } = record(value);
  if (!Array.isArray(items) || items.length > Number(query.get('limit') ?? 20)
    || (nextCursor !== null && (typeof nextCursor !== 'string' || !cursor.test(nextCursor)))) {
    throw new Error('Invalid Client directory page');
  }
  return { items: items.map(directoryItem), nextCursor };
}

const project = { list: directory, detail, self: profile };
const errorCodes = new Set(['UNAUTHENTICATED', 'FORBIDDEN', 'CLIENT_NOT_FOUND', 'INVALID_CLIENT_CURSOR',
  'INVALID_INPUT', 'RATE_LIMITED', 'INTERNAL_ERROR']);

export async function readClientRoute<R extends ClientRoute>(route: R, path: string, token: string, query: URLSearchParams) {
  try {
    const result = await api(path, 'GET', { token, query });
    if (result.ok) {
      const decode: (typeof project)[R] = project[route];
      const data = decode(await result.json(), query) as ReturnType<(typeof project)[R]>;
      return { ok: true as const, data };
    }
    const payload = await result.json().then(record).catch(() => ({} as Record<string, unknown>));
    const { code, requestId } = payload;
    return {
      ok: false as const, status: result.status,
      error: {
        code: typeof code === 'string' && errorCodes.has(code) ? code : 'API_REQUEST_FAILED',
        ...(typeof requestId === 'string' && uuid.test(requestId) ? { requestId } : {}),
      },
    };
  } catch {
    return { ok: false as const, status: 503, error: { code: 'DASHBOARD_UNAVAILABLE' } };
  }
}
