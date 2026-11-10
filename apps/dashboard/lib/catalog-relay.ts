type Method = 'GET' | 'POST' | 'PATCH';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function catalogRoute(method: Method, parts: string[]) {
  const [root, id, section, versionId, action] = parts;
  if (root === 'session-types') {
    if (parts.length === 1 && method === 'GET') return 'types';
    if (parts.length === 1 && method === 'POST') return 'typeCreated';
    if (parts.length === 3 && method === 'POST' && uuid.test(id) && section === 'archive') return 'empty';
  }
  if (root !== 'packages') return null;
  if (parts.length === 1) {
    if (method === 'GET') return 'published';
    if (method === 'POST') return 'packageCreated';
  }
  if (parts.length === 2 && id === 'management' && method === 'GET') return 'management';
  if (!uuid.test(id)) return null;
  if (parts.length === 3) {
    if (section === 'management' && method === 'GET') return 'detail';
    if (section === 'versions' && method === 'POST') return 'versionCreated';
    if (section === 'archive' && method === 'POST') return 'empty';
  }
  if (parts.length === 4) {
    if (section === 'management' && versionId === 'audit' && method === 'GET') return 'audit';
    if (section === 'versions' && uuid.test(versionId)) {
      if (method === 'GET') return 'version';
      if (method === 'PATCH') return 'empty';
    }
  }
  if (parts.length === 5 && section === 'versions' && uuid.test(versionId) && action === 'publish' && method === 'POST') {
    return 'empty';
  }
  return null;
}

type Route = NonNullable<ReturnType<typeof catalogRoute>>;
const paged = new Set<Route>(['types', 'published', 'management', 'detail', 'audit']);

export function catalogQuery(route: Route, input: URLSearchParams) {
  const query = new URLSearchParams();
  for (const [name, value] of input) {
    if (!paged.has(route) || query.has(name)
      || (name === 'limit' ? !/^(?:[1-9][0-9]?|100)$/.test(value) : name !== 'after' || !uuid.test(value))) return null;
    query.set(name, value);
  }
  return query;
}

const limit = 16 * 1024;

export async function catalogBody(request: Request): Promise<{ body: object } | { status: 400 | 413 }> {
  if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json' || !request.body) {
    return { status: 400 };
  }
  const reader = request.body.getReader();
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let raw = '';
    let size = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return { status: 413 };
      }
      raw += decoder.decode(value, { stream: true });
    }
    const body: unknown = JSON.parse(raw + decoder.decode());
    return body && typeof body === 'object' && !Array.isArray(body) ? { body } : { status: 400 };
  } catch {
    return { status: 400 };
  } finally {
    reader.releaseLock();
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid upstream catalog response');
  return value as Record<string, unknown>;
}

function fields(value: unknown, keys: readonly string[]) {
  const source = record(value);
  const result: Record<string, string | number | boolean | null> = {};
  for (const key of keys) {
    const v = source[key];
    if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') result[key] = v;
  }
  return result;
}

function list(value: unknown, project: (item: unknown) => object) {
  if (!Array.isArray(value)) throw new Error('Invalid upstream catalog list');
  return value.map(project);
}

const offerFields = ['id', 'code', 'archivedAt'];
const versionFields = ['id', 'packageId', 'version', 'name', 'description', 'price', 'currency', 'kind',
  'validityDays', 'sessionAllowance', 'publishedAt'];
const typeFields = ['id', 'code', 'name', 'mode'];
const sessionType = (value: unknown) => fields(value, typeFields);

function version(value: unknown, management = false) {
  return {
    ...fields(value, [...versionFields, ...(management ? ['draftRevision', 'supersededAt', 'basedOnVersionId'] : ['code'])]),
    sessionTypes: list(record(value).sessionTypes, sessionType),
  };
}

export function catalogResponse(route: Route, value: unknown) {
  const body = record(value);
  const page = (project: (item: unknown) => object) => ({
    items: list(body.items, project), ...fields(body, ['nextCursor']),
  });
  switch (route) {
    case 'packageCreated': return fields(body, ['packageId']);
    case 'versionCreated': return fields(body, ['versionId']);
    case 'typeCreated': return fields(body, ['sessionTypeId']);
    case 'types': return page(sessionType);
    case 'published': return page(item => version(item));
    case 'version': return version(body);
    case 'management': return page(item => {
      const { currentVersion } = record(item);
      return { ...fields(item, offerFields), currentVersion: currentVersion === null ? null : fields(currentVersion, ['id', 'version']) };
    });
    case 'detail': return { ...fields(body, offerFields), ...page(item => version(item, true)) };
    case 'audit': return page(item => {
      const details = record(record(item).details);
      return {
        ...fields(item, ['id', 'createdAt', 'actorId', 'action', 'requestId', 'reason']),
        details: {
          ...fields(details, ['versionId', 'basedOnVersionId', 'previousVersionId', 'version', 'draftRevision', 'effectiveAt']),
          ...(Array.isArray(details.changedFields) ? { changedFields: details.changedFields.filter(field =>
            ['name', 'description', 'price', 'kind', 'validityDays', 'sessionAllowance', 'sessionTypeIds'].includes(field)) } : {}),
        },
      };
    });
    default: throw new Error('Unexpected catalog response');
  }
}

const codes = new Set([
  'UNAUTHENTICATED', 'FORBIDDEN', 'INVALID_INPUT', 'PAYLOAD_TOO_LARGE', 'INVALID_CATALOG_CURSOR',
  'CATALOG_VERSION_NOT_FOUND', 'CATALOG_PACKAGE_NOT_FOUND', 'SESSION_TYPE_NOT_FOUND', 'NOT_FOUND',
  'CATALOG_CURRENT_VERSION_CHANGED', 'CATALOG_DRAFT_CHANGED', 'CATALOG_VERSION_ISSUED', 'CATALOG_PACKAGE_ARCHIVED',
  'CATALOG_CODE_EXISTS', 'CATALOG_CONFLICT', 'SESSION_TYPE_ARCHIVED', 'INVALID_SESSION_TYPE', 'INVALID_SESSION_ALLOWANCE',
  'EMPTY_CATALOG_EDIT', 'CATALOG_ELIGIBILITY_REQUIRED', 'INVALID_IDEMPOTENCY_KEY', 'IDEMPOTENCY_KEY_REUSED',
  'IDEMPOTENCY_KEY_EXPIRED', 'RETRY_TRANSACTION', 'RATE_LIMITED', 'INTERNAL_ERROR',
]);

export async function catalogError(response: Response) {
  try {
    const { code, requestId } = record(await response.json());
    return {
      code: typeof code === 'string' && codes.has(code) ? code : 'API_REQUEST_FAILED',
      ...(typeof requestId === 'string' && uuid.test(requestId) ? { requestId } : {}),
    };
  } catch {
    return { code: 'API_REQUEST_FAILED' };
  }
}
