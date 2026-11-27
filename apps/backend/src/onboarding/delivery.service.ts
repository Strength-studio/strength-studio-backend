import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CONFIG, Config } from '../platform/config';
import { Database, databaseTime } from '../platform/database';
import { lockIdentity } from '../identity/session.service';
import { unseal } from './security';

export type VerificationEmail = { to: string; url: string; subject: string; text: string };
export interface VerificationTransport { send(message: VerificationEmail): Promise<void>; }
export class FakeVerificationTransport implements VerificationTransport {
  readonly messages: VerificationEmail[] = [];
  async send(message: VerificationEmail) { this.messages.push({ ...message }); }
}

// There is deliberately no provider adapter or default sender. Dispatch is driven
// by an explicitly supplied adapter, e.g. a fake in an isolated test harness.
@Injectable()
export class OnboardingDeliveryService {
  constructor(private readonly db: Database, @Inject(CONFIG) private readonly config: Config) {}

  async dispatch(transport: VerificationTransport, limit = 10) {
    if (!this.config.onboardingKey) throw new Error('Onboarding delivery key unavailable');
    let processed = 0;
    for (let i = 0; i < Math.min(limit, 100); i++) {
      const now = await databaseTime(this.db);
      const candidate = await this.db.onboardingDelivery.findFirst({
        where: { acceptedAt: null, failedAt: null, availableAt: { lte: now },
          OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] }, orderBy: { createdAt: 'asc' },
        select: { id: true, challenge: { select: { userId: true } } },
      });
      if (!candidate) break;
      const leaseId = randomUUID();
      const claimed = await this.db.command(async tx => {
        await lockIdentity(tx, candidate.challenge.userId, undefined, { targetUser: candidate.challenge.userId });
        await tx.$queryRaw`SELECT id FROM onboarding_delivery WHERE id = ${candidate.id}::uuid FOR UPDATE`;
        const row = await tx.onboardingDelivery.findUniqueOrThrow({ where: { id: candidate.id },
          include: { challenge: { include: { onboarding: { include: { user: true } } } } } });
        const time = await databaseTime(tx), c = row.challenge, o = c.onboarding;
        if (row.acceptedAt || row.failedAt || row.availableAt > time || (row.leaseUntil && row.leaseUntil > time)) return null;
        if (c.consumedAt || c.revokedAt || c.expiresAt <= time || o.revokedAt || o.completedAt
          || c.revision !== o.revision || o.user.accountState !== 'PENDING_VERIFICATION' || row.attempts >= 8) {
          await tx.onboardingDelivery.update({ where: { id: row.id }, data: { failedAt: time, ciphertext: null, leaseId: null, leaseUntil: null } });
          return null;
        }
        await tx.onboardingDelivery.update({ where: { id: row.id }, data: {
          leaseId, leaseUntil: new Date(time.valueOf() + 30_000), attempts: { increment: 1 },
        } });
        return row;
      });
      if (!claimed) continue;
      let success = false;
      try {
        const message = unseal<VerificationEmail>(this.config.onboardingKey, claimed.challengeId, claimed.ciphertext!);
        await transport.send(message); success = true;
      } catch { /* Provider exceptions and their potentially secret-bearing text never enter logs. */ }
      await this.db.command(async tx => {
        await lockIdentity(tx, candidate.challenge.userId, undefined, { targetUser: candidate.challenge.userId });
        const time = await databaseTime(tx);
        await tx.onboardingDelivery.updateMany({ where: { id: claimed.id, leaseId }, data: success
          ? { acceptedAt: time, ciphertext: null, leaseId: null, leaseUntil: null }
          : { availableAt: new Date(time.valueOf() + Math.min(3600, 30 * 2 ** claimed.attempts) * 1000), leaseId: null, leaseUntil: null } });
      });
      processed++;
    }
    return processed;
  }
}
