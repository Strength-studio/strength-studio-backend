import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AccountState, AuditAction, AuditTarget, Prisma, Role, TokenPurpose } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { CONFIG, Config } from '../platform/config';
import { Database, databaseTime, Transaction } from '../platform/database';
import { audit } from '../platform/audit';
import { failure } from '../platform/http';
import { AccessEvents } from './access-events';
import { Action, hasAction } from './permissions';
import { checkPassword, hashPassword } from './password';

const ACCESS_SECONDS = 300;
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const TICKET_MS = 30_000;
const issuer = 'strength-studio';
const audience = 'strength-studio-api';
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const opaque = /^[\w-]{43}$/;
const secret = () => randomBytes(32).toString('base64url');
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');

const identity = {
  id: true, normalizedEmail: true, role: true, accountState: true, emailVerifiedAt: true,
  grants: { where: { revokedAt: null }, select: { permission: true } },
} satisfies Prisma.UserSelect;

const sessionView = {
  id: true, userId: true, expiresAt: true, revokedAt: true, user: { select: identity },
} satisfies Prisma.AuthSessionSelect;

export type SessionView = Prisma.AuthSessionGetPayload<{ select: typeof sessionView }>;
export type AccessContext = { userId: string; sessionId: string; expiresAt: number };
export type SocketAccess = { userId: string; sessionId: string; expiresAt: Date; fingerprint: string };

export function fingerprint(session: SessionView): string {
  return JSON.stringify([session.user.role, session.user.grants.map(g => g.permission).sort()]);
}

function active(user: Pick<SessionView['user'], 'accountState' | 'emailVerifiedAt'>) {
  return user.accountState === AccountState.ACTIVE && user.emailVerifiedAt !== null;
}

function isCurrent(session: SessionView | null, now: Date): session is SessionView {
  return !!session && session.revokedAt === null && session.expiresAt > now && active(session.user);
}

function unauthorized() {
  return failure(401, 'UNAUTHENTICATED');
}

export async function lockIdentity(
  tx: Transaction, userId: string, sessionId?: string,
  options: { targetUser?: string; exclusiveSession?: boolean; revokeTargetSessions?: boolean } = {},
) {
  const userIds = [...new Set([userId, ...(options.targetUser ? [options.targetUser] : [])])].sort();
  for (const id of userIds) {
    if (id === options.targetUser) {
      await tx.$queryRaw`SELECT id FROM app_user WHERE id = ${id}::uuid FOR UPDATE`;
    } else {
      await tx.$queryRaw`SELECT id FROM app_user WHERE id = ${id}::uuid FOR SHARE`;
    }
  }
  const targetSessions = options.revokeTargetSessions && options.targetUser
    ? await tx.authSession.findMany({ where: { userId: options.targetUser, revokedAt: null }, select: { id: true } })
    : [];
  const exclusive = new Set(targetSessions.map(session => session.id));
  if (sessionId && options.exclusiveSession) exclusive.add(sessionId);
  const sessionIds = [...new Set([...exclusive, ...(sessionId ? [sessionId] : [])])].sort();
  for (const id of sessionIds) {
    if (exclusive.has(id)) {
      await tx.$queryRaw`SELECT id FROM auth_session WHERE id = ${id}::uuid FOR UPDATE`;
    } else {
      await tx.$queryRaw`SELECT id FROM auth_session WHERE id = ${id}::uuid FOR SHARE`;
    }
  }
}

@Injectable()
export class Sessions {
  private readonly jwt: JwtService;
  private readonly dummyHash = hashPassword(secret());
  private passwordChecks = 0;

  constructor(private readonly db: Database, @Inject(CONFIG) config: Config, private readonly events: AccessEvents) {
    this.jwt = new JwtService({ secret: config.signingKey });
  }

  parseAccess(header?: string): AccessContext {
    if (!header?.startsWith('Bearer ')) throw unauthorized();
    try {
      const claims = this.jwt.verify<{ sub: string; sid: string; exp: number }>(header.slice(7), {
        algorithms: ['HS256'], issuer, audience,
      });
      if (!uuid.test(claims.sub) || !uuid.test(claims.sid) || !Number.isInteger(claims.exp)) throw unauthorized();
      return { userId: claims.sub, sessionId: claims.sid, expiresAt: claims.exp * 1000 };
    } catch {
      throw unauthorized();
    }
  }

  async authorize(tx: Transaction, access: AccessContext, actions: Action[]): Promise<SessionView> {
    const session = await tx.authSession.findUnique({ where: { id: access.sessionId }, select: sessionView });
    const now = await databaseTime(tx);
    if (!isCurrent(session, now) || session.userId !== access.userId || access.expiresAt <= now.valueOf()) throw unauthorized();
    if (!actions.some(action => hasAction(session.user.role, session.user.grants.map(g => g.permission), action))) {
      throw failure(403, 'FORBIDDEN');
    }
    return session;
  }

  async login(email: string, password: string) {
    if (this.passwordChecks >= 2) throw failure(429, 'AUTH_BUSY');
    const user = await this.db.user.findUnique({ where: { normalizedEmail: email.trim().toLowerCase() } });
    if (this.passwordChecks >= 2) throw failure(429, 'AUTH_BUSY');
    this.passwordChecks++;
    let correct: boolean;
    try {
      correct = await checkPassword(user?.passwordHash ?? await this.dummyHash, password).catch(() => false);
    } finally {
      this.passwordChecks--;
    }
    if (!correct || !user?.passwordHash || !active(user)) throw unauthorized();
    const created = await this.db.command(async tx => {
      await lockIdentity(tx, user.id);
      const current = await tx.user.findUnique({ where: { id: user.id } });
      if (!current || !active(current) || current.passwordHash !== user.passwordHash) throw unauthorized();
      const now = await databaseTime(tx);
      const session = await tx.authSession.create({ data: { userId: user.id, expiresAt: new Date(now.valueOf() + SESSION_MS) } });
      return { session, refreshToken: await this.issue(tx, session, TokenPurpose.REFRESH, session.expiresAt) };
    });
    return this.tokenPair(created.session, created.refreshToken);
  }

  async refresh(value: string, requestId: string) {
    const candidate = await this.tokenCandidate(value, TokenPurpose.REFRESH);
    const result = await this.db.command(async tx => {
      await lockIdentity(tx, candidate.userId, candidate.sessionId, { exclusiveSession: true });
      const token = await tx.authToken.findUnique({ where: { id: candidate.id } });
      const session = await tx.authSession.findUnique({ where: { id: candidate.sessionId }, select: sessionView });
      const now = await databaseTime(tx);
      if (!token || !isCurrent(session, now) || token.expiresAt <= now) throw unauthorized();
      if (token.consumedAt) {
        await tx.authSession.update({ where: { id: session.id }, data: { revokedAt: now } });
        await audit(tx, { actorId: session.userId, action: AuditAction.REFRESH_REPLAY, targetType: AuditTarget.AUTH_SESSION,
          targetId: session.id, requestId });
        return null;
      }
      await tx.authToken.update({ where: { id: token.id }, data: { consumedAt: now } });
      const refreshToken = await this.issue(tx, session, TokenPurpose.REFRESH, session.expiresAt);
      return { session, refreshToken };
    });
    if (!result) {
      this.events.revoke(candidate.userId, candidate.sessionId);
      throw unauthorized();
    }
    return this.tokenPair(result.session, result.refreshToken);
  }

  async logout(access: AccessContext, requestId: string) {
    await this.db.command(async tx => {
      await lockIdentity(tx, access.userId, access.sessionId, { exclusiveSession: true });
      const session = await this.authorize(tx, access, ['account.self']);
      await tx.authSession.update({ where: { id: session.id }, data: { revokedAt: await databaseTime(tx) } });
      await audit(tx, { actorId: session.userId, action: AuditAction.SESSION_REVOKED, targetType: AuditTarget.AUTH_SESSION,
        targetId: session.id, requestId });
    });
    this.events.revoke(access.userId, access.sessionId);
  }

  async logoutWithRefresh(value: string, requestId: string) {
    const candidate = await this.tokenCandidate(value, TokenPurpose.REFRESH);
    await this.db.command(async tx => {
      await lockIdentity(tx, candidate.userId, candidate.sessionId, { exclusiveSession: true });
      const token = await tx.authToken.findUnique({ where: { id: candidate.id } });
      const session = await tx.authSession.findUnique({ where: { id: candidate.sessionId }, select: sessionView });
      const now = await databaseTime(tx);
      if (!token || !isCurrent(session, now) || token.expiresAt <= now) throw unauthorized();
      await tx.authSession.update({ where: { id: session.id }, data: { revokedAt: now } });
      await audit(tx, { actorId: session.userId, action: AuditAction.SESSION_REVOKED, targetType: AuditTarget.AUTH_SESSION,
        targetId: session.id, requestId });
    });
    this.events.revoke(candidate.userId, candidate.sessionId);
  }

  async socketTicket(access: AccessContext) {
    return this.db.command(async tx => {
      await lockIdentity(tx, access.userId, access.sessionId);
      const session = await this.authorize(tx, access, ['account.self']);
      const now = await databaseTime(tx);
      const expiresAt = new Date(Math.min(session.expiresAt.valueOf(), now.valueOf() + TICKET_MS));
      const ticket = await this.issue(tx, session, TokenPurpose.SOCKET, expiresAt);
      return { ticket, expiresAt };
    });
  }

  async consumeSocketTicket(value: string): Promise<SocketAccess> {
    const candidate = await this.tokenCandidate(value, TokenPurpose.SOCKET);
    return this.db.command(async tx => {
      await lockIdentity(tx, candidate.userId, candidate.sessionId);
      await tx.$queryRaw`SELECT id FROM auth_token WHERE id = ${candidate.id}::uuid FOR UPDATE`;
      const token = await tx.authToken.findUnique({ where: { id: candidate.id } });
      const session = await tx.authSession.findUnique({ where: { id: candidate.sessionId }, select: sessionView });
      const now = await databaseTime(tx);
      if (!token || token.consumedAt || token.expiresAt <= now || !isCurrent(session, now)) throw unauthorized();
      await tx.authToken.update({ where: { id: token.id }, data: { consumedAt: now } });
      return { userId: session.userId, sessionId: session.id, expiresAt: session.expiresAt, fingerprint: fingerprint(session) };
    });
  }

  async currentSockets(ids: string[]) {
    return this.db.command(async tx => {
      const sessions = await tx.authSession.findMany({ where: { id: { in: ids } }, select: sessionView });
      const now = await databaseTime(tx);
      return new Map(sessions.filter(s => isCurrent(s, now)).map(s => [s.id, fingerprint(s)]));
    });
  }

  private async tokenCandidate(value: string, purpose: TokenPurpose) {
    if (typeof value !== 'string' || !opaque.test(value)) throw unauthorized();
    const token = await this.db.authToken.findUnique({ where: { digest: digest(value) } });
    if (!token || token.purpose !== purpose || !token.sessionId) throw unauthorized();
    return { ...token, sessionId: token.sessionId };
  }

  private async issue(tx: Transaction, session: { id: string; userId: string }, purpose: TokenPurpose, expiresAt: Date) {
    const value = secret();
    await tx.authToken.create({ data: { sessionId: session.id, userId: session.userId, purpose, expiresAt, digest: digest(value) } });
    return value;
  }

  private tokenPair(session: { userId: string; id: string; expiresAt: Date }, refreshToken: string) {
    const expiresIn = Math.min(ACCESS_SECONDS, Math.max(1, Math.floor((session.expiresAt.valueOf() - Date.now()) / 1000)));
    const accessToken = this.jwt.sign({ sid: session.id }, {
      subject: session.userId, issuer, audience, algorithm: 'HS256', expiresIn,
    });
    return { accessToken, refreshToken, expiresIn, refreshExpiresAt: session.expiresAt };
  }
}
