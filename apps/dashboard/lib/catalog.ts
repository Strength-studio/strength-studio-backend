export type Account = { id: string; email: string; role: string };
export type SessionType = { id: string; code: string; name: string; mode: 'INDIVIDUAL' | 'GROUP' };
export type Page<T> = { items: T[]; nextCursor: string | null };
export type Terms = {
  name: string; description: string; price: string; kind: 'TIME' | 'SESSION';
  validityDays: number; sessionAllowance: number | null; sessionTypeIds?: string[];
};
export type Version = Omit<Terms, 'sessionTypeIds'> & {
  id: string; packageId: string; version: number; currency: 'SAR';
  publishedAt: string | null; sessionTypes: SessionType[];
};
export type DraftVersion = Version & {
  draftRevision: number; supersededAt: string | null; basedOnVersionId: string | null;
};
export type Offer = { id: string; code: string; archivedAt: string | null; currentVersion: { id: string; version: number } | null };
export type PackageDetail = Omit<Offer, 'currentVersion'> & { versions: DraftVersion[] };
export type AuditEvent = {
  id: string; action: string; actorId: string | null; createdAt: string; requestId: string | null; reason: string | null;
  details: Record<string, string | number | string[] | null>;
};

export class CatalogError extends Error {
  constructor(readonly status: number, readonly code: string, readonly requestId?: string) {
    super(code);
  }
}

const messages: Record<string, string> = {
  CATALOG_DRAFT_CHANGED: 'This draft changed while you were working. Review the latest revision before trying again.',
  CATALOG_CURRENT_VERSION_CHANGED: 'The current published version changed. Review the latest package before continuing.',
  CATALOG_VERSION_ISSUED: 'This version has already been issued. Its terms are read-only.',
  CATALOG_PACKAGE_ARCHIVED: 'This package has been archived and can no longer be changed.',
  CATALOG_CODE_EXISTS: 'That code already exists. Use a unique code.',
  SESSION_TYPE_ARCHIVED: 'This session type has already been archived.',
  INVALID_SESSION_TYPE: 'An eligible session type is missing or archived. Review the active types.',
  INVALID_SESSION_ALLOWANCE: 'Session packages require a positive allowance. Time packages cannot have an allowance.',
  CATALOG_ELIGIBILITY_REQUIRED: 'Add at least one active session type before publishing.',
  IDEMPOTENCY_KEY_REUSED: 'This request key was already used for a different change. Review the latest state.',
  IDEMPOTENCY_KEY_EXPIRED: 'This request key expired. Check the latest state before submitting a new request.',
  RATE_LIMITED: 'Too many requests. Wait a moment, then try again.',
};

export function errorText(error: unknown) {
  if (!(error instanceof CatalogError)) return 'Something went wrong. Please try again.';
  return messages[error.code] ?? ({
    400: 'Check the form values and try again.',
    401: 'Your session expired. Sign in or restore your session.',
    403: 'Your account does not have permission for this action.',
    404: 'This package, version, or session type could not be found.',
    409: 'The catalog changed. Review the latest state before continuing.',
    413: 'The request is too large.',
    503: 'The catalog service is temporarily unavailable.',
  }[error.status] ?? 'Could not complete the request.');
}

async function checked(response: Response) {
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new CatalogError(response.status, error.code ?? 'API_REQUEST_FAILED', error.requestId);
  }
  return response;
}

async function request(path: string, init?: RequestInit) {
  const response = await fetch(path, { ...init, cache: 'no-store' }).catch(() => {
    throw new CatalogError(503, 'DASHBOARD_UNAVAILABLE');
  });
  return checked(response);
}

export async function get<T>(path: string): Promise<T> {
  return (await request('/api/studio/v1/' + path)).json();
}

export type CatalogWrite = { path: string; method: 'POST' | 'PATCH'; body: string; key: string };

export function newWrite(path: string, payload: object, method: CatalogWrite['method'] = 'POST'): CatalogWrite {
  return { path, method, body: JSON.stringify(payload), key: crypto.randomUUID() };
}

export async function write<T = { packageId?: string; versionId?: string; sessionTypeId?: string }>(intent: CatalogWrite): Promise<Partial<T>> {
  const { csrfToken } = await (await request('/api/session/csrf')).json();
  const response = await request('/api/studio/v1/' + intent.path, {
    method: intent.method, body: intent.body,
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken, 'Idempotency-Key': intent.key },
  });
  return response.status === 204 ? {} : await response.json() as T;
}

export async function capability(path: string) {
  try {
    await get(path);
    return true;
  } catch (error) {
    if (error instanceof CatalogError && error.status === 403) return false;
    throw error;
  }
}

export function pagedPath(path: string, limit: number, cursor?: string | null) {
  return path + '?' + new URLSearchParams({ limit: String(limit), ...(cursor ? { after: cursor } : {}) });
}

export async function packageDetail(id: string): Promise<PackageDetail> {
  const path = 'packages/' + id + '/management';
  const first = await get<Omit<Offer, 'currentVersion'> & Page<DraftVersion>>(pagedPath(path, 100));
  const versions = [...first.items];
  let cursor = first.nextCursor;
  while (cursor) {
    const next = await get<Page<DraftVersion>>(pagedPath(path, 100, cursor));
    versions.push(...next.items);
    cursor = next.nextCursor;
  }
  return { id: first.id, code: first.code, archivedAt: first.archivedAt, versions };
}

export async function activeTypes() {
  const types: SessionType[] = [];
  let cursor: string | null = null;
  do {
    const page: Page<SessionType> = await get(pagedPath('session-types', 100, cursor));
    types.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return types;
}

export function currentVersion(offer: PackageDetail) {
  return offer.archivedAt ? undefined : offer.versions.find(version => version.publishedAt && !version.supersededAt);
}

export function money(price: string) {
  const [whole, fraction] = price.split('.');
  return 'SAR ' + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + (fraction ?? '').padEnd(2, '0');
}

export function dateTime(value: string) {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Riyadh' }).format(new Date(value));
}

export const pricePattern = '(0|[1-9][0-9]{0,14})(\\.[0-9]{1,2})?';
export const zeroPrice = (price: string) => /^0(?:\.0{1,2})?$/.test(price);
