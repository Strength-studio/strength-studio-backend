import { Inject, Injectable } from '@nestjs/common';
import { AuditAction, AuditTarget, OnboardingPurpose, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AccessContext, digest, lockIdentity, Sessions } from '../identity/session.service';
import { hashPassword } from '../identity/password';
import { audit } from '../platform/audit';
import { Commands } from '../platform/commands';
import { CONFIG, Config } from '../platform/config';
import { Database, databaseTime, Transaction } from '../platform/database';
import { failure } from '../platform/http';
import { InviteDto, OnboardingCommandDto } from './onboarding.dto';
import { PASSWORD_MS, PROOF_MS, seal, secret, validSecret } from './security';

const invalid = () => failure(400, 'CHALLENGE_INVALID_OR_EXPIRED');

@Injectable()
export class OnboardingService {
  private hashing = 0;
  constructor(private readonly db: Database, private readonly commands: Commands, private readonly sessions: Sessions,
    @Inject(CONFIG) private readonly config: Config) {}

  private available() {
    if (!this.config.onboardingKey || !this.config.dashboardOrigin) throw failure(503, 'ONBOARDING_UNAVAILABLE');
  }
  private async rejected(requestId: string, stage: string, actorId: string | null = null) {
    await this.db.command(async tx => {
      if (actorId) await lockIdentity(tx, actorId);
      await audit(tx, { actorId, action: AuditAction.ONBOARDING_REJECTED,
        targetType: AuditTarget.ONBOARDING_REQUEST, targetId: requestId, requestId,
        redactedDetails: { stage, outcome: 'REJECTED' } });
    });
  }
  async invite(dto: InviteDto, access: AccessContext, key: string | undefined, requestId: string) {
    this.available();
    const value = secret();
    let outcome;
    try {
      outcome = await this.commands.run({ access, action: 'user.manage', operation: 'client.invite', key,
        args: [dto.email, dto.displayName], write: async tx => {
          // The narrow DB function can only create a CLIENT with no credentials.
          const [{ id }] = await tx.$queryRaw<{ id: string }[]>`
            SELECT public.onboarding_create_client(${access.userId}::uuid, ${dto.email}, ${dto.displayName}) AS id`;
          await tx.clientOnboarding.create({ data: { userId: id, createdBy: access.userId } });
          const challenge = await this.issue(tx, id, OnboardingPurpose.SETUP, 1, value, false);
          await audit(tx, { actorId: access.userId, action: AuditAction.CLIENT_INVITED,
            targetType: AuditTarget.USER, targetId: id, requestId,
            redactedDetails: { challengeId: challenge.id, outcome: 'INVITED' } });
          return { status: 201, reference: challenge.id };
        } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2002'
        || (error.code === 'P2010' && error.meta?.code === '23505'))) {
        await this.rejected(requestId, 'INVITE_CONFLICT', access.userId);
        throw failure(409, 'CLIENT_IDENTITY_CONFLICT');
      }
      throw error;
    }
    return this.disclosure(outcome.reference!, outcome.executed ? value : undefined, access);
  }
  private async disclosure(id: string, value: string | undefined, access: AccessContext) {
    await this.sessions.authorize(this.db, access, ['user.manage']);
    const c = await this.db.onboardingChallenge.findUniqueOrThrow({ where: { id } });
    return { clientId: c.userId, challengeId: c.id, expiresAt: c.expiresAt, linkAvailable: !!value,
      ...(value ? { setupLink: this.config.dashboardOrigin + '/setup#token=' + value } : {}) };
  }
  private async scoped(tx: Transaction, id: string) {
    const row = await tx.user.findFirst({ where: { id, role: 'CLIENT', client: { isNot: null } }, include: { onboarding: true } });
    if (!row?.onboarding) throw failure(404, 'CLIENT_ONBOARDING_NOT_FOUND');
    return row as typeof row & { onboarding: NonNullable<typeof row.onboarding> };
  }
  async status(id: string, access: AccessContext) {
    await this.sessions.authorize(this.db, access, ['user.manage']);
    const user = await this.db.user.findFirst({ where: { id, role: 'CLIENT', client: { isNot: null } }, include: { onboarding: true } });
    if (!user) throw failure(404, 'CLIENT_NOT_FOUND');
    const o = user.onboarding;
    if (!o) return { status: 'NOT_STARTED' };
    const latest = await this.db.onboardingChallenge.findFirst({ where: { userId: id, revision: o.revision },
      orderBy: { createdAt: 'desc' }, include: { delivery: true } });
    return { status: user.accountState === 'DISABLED' ? 'DISABLED' : o.revokedAt ? 'REVOKED'
      : o.completedAt ? 'COMPLETED' : user.accountState === 'INVITED' ? 'INVITED'
        : latest?.purpose === 'PASSWORD' ? 'SET_PASSWORD' : 'VERIFY_EMAIL', revision: o.revision,
      expiresAt: latest?.expiresAt ?? null,
      canReissueAt: latest ? new Date(latest.createdAt.valueOf() + 60_000) : null,
      delivery: latest?.delivery ? latest.delivery.acceptedAt ? 'ACCEPTED' : latest.delivery.failedAt ? 'FAILED' : 'QUEUED' : null };
  }
  async manage(id: string, kind: 'reissue' | 'revoke', dto: OnboardingCommandDto,
    access: AccessContext, key: string | undefined, requestId: string) {
    this.available();
    const value = secret();
    const outcome = await this.commands.run({ access, action: 'user.manage', operation: 'client.onboarding.' + kind,
      key, args: [id, dto.expectedRevision, dto.reason], targetUser: id,
      scope: tx => this.scoped(tx, id).then(() => {}), write: async tx => {
        const user = await this.scoped(tx, id), o = user.onboarding;
        if (o.revision !== dto.expectedRevision) throw failure(409, 'ONBOARDING_CHANGED');
        if (o.completedAt || o.revokedAt || user.accountState === 'DISABLED'
          || (kind === 'reissue' && user.accountState !== 'INVITED')) throw failure(409, 'ONBOARDING_NOT_ELIGIBLE');
        const now = await databaseTime(tx);
        if (kind === 'reissue' && !await this.canReplace(tx, id, OnboardingPurpose.SETUP, now)) throw failure(409, 'ONBOARDING_RATE_LIMITED');
        await this.invalidate(tx, id, now);
        const revision = o.revision + 1;
        await tx.clientOnboarding.update({ where: { userId: id }, data: { revision, ...(kind === 'revoke' ? { revokedAt: now } : {}) } });
        const challenge = kind === 'reissue' ? await this.issue(tx, id, OnboardingPurpose.SETUP, revision, value, true) : null;
        await audit(tx, { actorId: access.userId, action: kind === 'reissue' ? AuditAction.SETUP_LINK_REISSUED : AuditAction.ONBOARDING_REVOKED,
          targetType: AuditTarget.USER, targetId: id, requestId, reason: dto.reason,
          redactedDetails: { revision, outcome: kind === 'reissue' ? 'REISSUED' : 'REVOKED' } });
        return { status: kind === 'reissue' ? 200 : 204, reference: challenge?.id ?? id };
      } });
    if (kind === 'revoke') return;
    return this.disclosure(outcome.reference!, outcome.executed ? value : undefined, access);
  }
  private async canReplace(tx: Transaction, userId: string, purpose: OnboardingPurpose, now: Date) {
    const latest = await tx.onboardingChallenge.findFirst({ where: { userId, purpose }, orderBy: { createdAt: 'desc' } });
    if (latest && now.valueOf() - latest.createdAt.valueOf() < 60_000) return false;
    return await tx.onboardingChallenge.count({ where: { userId, purpose, replacement: true,
      createdAt: { gt: new Date(now.valueOf() - 3600_000) } } }) < 5;
  }
  private async invalidate(tx: Transaction, userId: string, now: Date) {
    await tx.onboardingChallenge.updateMany({ where: { userId, consumedAt: null, revokedAt: null }, data: { revokedAt: now } });
    await tx.onboardingDelivery.updateMany({ where: { challenge: { userId }, acceptedAt: null, failedAt: null },
      data: { ciphertext: null, failedAt: now, leaseId: null, leaseUntil: null } });
  }
  private async issue(tx: Transaction, userId: string, purpose: OnboardingPurpose, revision: number,
    value: string, replacement: boolean) {
    const now = await databaseTime(tx);
    return tx.onboardingChallenge.create({ data: { userId, purpose, revision, replacement, digest: digest(value), createdAt: now,
      expiresAt: new Date(now.valueOf() + (purpose === 'PASSWORD' ? PASSWORD_MS : PROOF_MS)) } });
  }
  private async email(tx: Transaction, userId: string, address: string, revision: number, replacement: boolean, requestId: string) {
    const value = secret(), c = await this.issue(tx, userId, OnboardingPurpose.EMAIL, revision, value, replacement);
    await tx.onboardingDelivery.create({ data: { challengeId: c.id,
      ciphertext: seal(this.config.onboardingKey!, c.id, { to: address, url: this.config.dashboardOrigin + '/verify-email#token=' + value,
        subject: 'Verify your email | تأكيد البريد الإلكتروني',
        text: 'Verify your email using this single-use link within 24 hours. Then set your password. / أكّد بريدك عبر الرابط خلال 24 ساعة ثم عيّن كلمة المرور.' }) } });
    await audit(tx, { actorId: null, action: AuditAction.EMAIL_CHALLENGE_ISSUED,
      targetType: AuditTarget.USER, targetId: userId, requestId, redactedDetails: { challengeId: c.id, replacement, outcome: 'QUEUED' } });
  }
  private async consume<T>(value: string, purpose: OnboardingPurpose, requestId: string,
    write: (tx: Transaction, c: { id: string; userId: string; revision: number }, email: string) => Promise<T>) {
    try {
      if (!validSecret(value)) throw invalid();
      const candidate = await this.db.onboardingChallenge.findUnique({ where: { digest: digest(value) } });
      if (!candidate || candidate.purpose !== purpose) throw invalid();
      return await this.db.command(async tx => {
        // All onboarding writers serialize on the User before touching child proofs.
        await lockIdentity(tx, candidate.userId, undefined, { targetUser: candidate.userId });
        const c = await tx.onboardingChallenge.findUniqueOrThrow({ where: { id: candidate.id },
          include: { onboarding: { include: { user: { include: { client: true } } } } } });
        const o = c.onboarding, user = o.user, now = await databaseTime(tx);
        if (c.consumedAt || c.revokedAt || c.expiresAt <= now || c.revision !== o.revision || o.revokedAt || o.completedAt
          || user.role !== 'CLIENT' || !user.client || user.passwordHash !== null
          || user.accountState !== (purpose === 'SETUP' ? 'INVITED' : 'PENDING_VERIFICATION')
          || (purpose === 'PASSWORD' && user.emailVerifiedAt === null)) throw invalid();
        await tx.onboardingChallenge.update({ where: { id: c.id }, data: { consumedAt: now } });
        return write(tx, c, user.normalizedEmail);
      });
    } catch (error) {
      // A proof may cross its deadline between the post-lock sample and the
      // credential function's defensive DB-time check. Keep that a generic denial.
      const cause = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2010'
        && error.meta?.code === '23514' && /invalid (onboarding|password authorization)/.test(String(error.meta?.message))
        ? invalid() : error;
      if (typeof cause === 'object' && cause && 'getStatus' in cause && (cause as { getStatus(): number }).getStatus() === 400) {
        await this.rejected(requestId, purpose); }
      throw cause;
    }
  }
  async accept(value: string, requestId: string) {
    this.available();
    await this.consume(value, OnboardingPurpose.SETUP, requestId, async (tx, c, email) => {
      await tx.user.update({ where: { id: c.userId }, data: { accountState: 'PENDING_VERIFICATION' } });
      await this.email(tx, c.userId, email, c.revision, false, requestId);
      await audit(tx, { actorId: null, action: AuditAction.SETUP_LINK_CONSUMED, targetType: AuditTarget.USER,
        targetId: c.userId, requestId, redactedDetails: { challengeId: c.id, outcome: 'PENDING_VERIFICATION' } });
    });
    return { accepted: true };
  }
  async verify(value: string, requestId: string) {
    this.available();
    return this.consume(value, OnboardingPurpose.EMAIL, requestId, async (tx, c) => {
      await tx.$executeRaw`SELECT public.onboarding_record_email(${c.userId}::uuid, ${c.id}::uuid)`;
      const token = secret(), authorization = await this.issue(tx, c.userId, OnboardingPurpose.PASSWORD, c.revision, token, false);
      await audit(tx, { actorId: c.userId, action: AuditAction.EMAIL_VERIFIED, targetType: AuditTarget.USER,
        targetId: c.userId, requestId, redactedDetails: { proofId: c.id, outcome: 'PASSWORD_PENDING' } });
      return { token, expiresAt: authorization.expiresAt };
    });
  }
  async password(value: string, password: string, requestId: string) {
    this.available();
    if (this.hashing >= 2) throw failure(429, 'AUTH_BUSY');
    // Validate the capability before expensive hashing, then recheck under the User lock.
    if (!validSecret(value)) {
      await this.rejected(requestId, 'PASSWORD');
      throw invalid();
    }
    const preliminary = await this.db.onboardingChallenge.findUnique({ where: { digest: digest(value) } });
    if (!preliminary || preliminary.purpose !== 'PASSWORD' || preliminary.consumedAt || preliminary.revokedAt
      || preliminary.expiresAt <= await databaseTime(this.db)) {
      await this.rejected(requestId, 'PASSWORD');
      throw invalid();
    }
    if (this.hashing >= 2) throw failure(429, 'AUTH_BUSY');
    this.hashing++;
    let hash: string;
    try { hash = await hashPassword(password); } finally { this.hashing--; }
    await this.consume(value, OnboardingPurpose.PASSWORD, requestId, async (tx, c) => {
      await tx.$executeRaw`SELECT public.onboarding_complete_password(${c.userId}::uuid, ${c.id}::uuid, ${hash})`;
      const now = await databaseTime(tx);
      await tx.clientOnboarding.update({ where: { userId: c.userId }, data: { completedAt: now } });
      await this.invalidate(tx, c.userId, now);
      for (const action of [AuditAction.PASSWORD_SETUP_COMPLETED, AuditAction.ACCOUNT_ENABLED]) {
        await audit(tx, { actorId: c.userId, action, targetType: AuditTarget.USER, targetId: c.userId,
          requestId, redactedDetails: { outcome: 'ACTIVE' } });
      }
    });
  }
  async resend(email: string, requestId: string) {
    this.available();
    const started = performance.now();
    try { return await this.resendEligible(email, requestId); }
    finally { await new Promise(resolve => setTimeout(resolve, Math.max(0, 80 - (performance.now() - started)))); }
  }
  private async resendEligible(email: string, requestId: string) {
    this.available(); // Same failure before target lookup, including nonexistent accounts.
    const candidate = await this.db.user.findUnique({ where: { normalizedEmail: email }, select: { id: true } });
    if (candidate) await this.db.command(async tx => {
      await lockIdentity(tx, candidate.id, undefined, { targetUser: candidate.id });
      const user = await tx.user.findUniqueOrThrow({ where: { id: candidate.id }, include: { onboarding: true, client: true } });
      const o = user.onboarding, now = await databaseTime(tx);
      if (!o || o.revokedAt || o.completedAt || user.role !== 'CLIENT' || !user.client || user.passwordHash
        || user.accountState !== 'PENDING_VERIFICATION' || !await this.canReplace(tx, user.id, OnboardingPurpose.EMAIL, now)) return;
      await this.invalidate(tx, user.id, now);
      await tx.clientOnboarding.update({ where: { userId: user.id }, data: { revision: { increment: 1 } } });
      await this.email(tx, user.id, user.normalizedEmail, o.revision + 1, true, requestId);
    });
    return { accepted: true };
  }
}
