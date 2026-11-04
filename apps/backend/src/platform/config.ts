export const CONFIG = Symbol('config');

export interface Config {
  databaseUrl: string;
  signingKey: Buffer;
  dashboardOrigin?: string;
  host: string;
  port: number;
  socketRecheckMs: number;
}

export function loadConfig(env = process.env): Config {
  let database: URL;
  try {
    database = new URL(env.DATABASE_URL ?? '');
  } catch {
    throw new Error('DATABASE_URL must be a PostgreSQL URL');
  }
  if (!['postgres:', 'postgresql:'].includes(database.protocol)) throw new Error('DATABASE_URL must be a PostgreSQL URL');
  const connections = Number(database.searchParams.get('connection_limit') ?? 4);
  if (!Number.isInteger(connections) || connections < 1 || connections > 4) throw new Error('Set connection_limit between 1 and 4');
  database.searchParams.set('connection_limit', String(connections));
  const key = env.AUTH_SIGNING_KEY ?? '';
  if (!/^[\da-f]{64}$/i.test(key)) throw new Error('AUTH_SIGNING_KEY must be 32 random bytes encoded as hex');
  const dashboardOrigin = env.DASHBOARD_ORIGIN;
  if (dashboardOrigin) {
    const url = new URL(dashboardOrigin);
    if (url.origin !== dashboardOrigin || !['https:', 'http:'].includes(url.protocol)
      || (url.protocol === 'http:' && (env.NODE_ENV === 'production' || !['localhost', '127.0.0.1'].includes(url.hostname)))) {
      throw new Error('DASHBOARD_ORIGIN must be an exact HTTPS origin or a local development origin');
    }
  }
  const port = Number(env.API_PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid API_PORT');

  return { databaseUrl: database.href, signingKey: Buffer.from(key, 'hex'), dashboardOrigin,
    host: env.API_HOST ?? '127.0.0.1', port, socketRecheckMs: 15_000 };
}
