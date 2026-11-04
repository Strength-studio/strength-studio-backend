import { Injectable } from '@nestjs/common';
import { Database, databaseTime, Transaction } from './database';
import { failure } from './http';
import { Action } from '../identity/permissions';
import { AccessContext, digest, lockIdentity, Sessions } from '../identity/session.service';

type Outcome = { status: number; reference?: string | null };

@Injectable()
export class Commands {
  constructor(private readonly db: Database, private readonly sessions: Sessions) {}

  run(input: {
    access: AccessContext; action: Action; key?: string; args: readonly unknown[]; targetUser?: string;
    revokeTargetSessions?: boolean;
    scope?: (tx: Transaction) => Promise<void>; write: (tx: Transaction) => Promise<Outcome>;
  }): Promise<Outcome & { executed: boolean }> {
    const { access, action, key, args } = input;
    if (!key || !/^[a-zA-Z0-9._-]{1,128}$/.test(key)) throw failure(400, 'INVALID_IDEMPOTENCY_KEY');
    const requestDigest = digest(JSON.stringify(args));
    return this.db.command(async tx => {
      await lockIdentity(tx, access.userId, access.sessionId, input);
      await this.sessions.authorize(tx, access, [action]);
      const now = await databaseTime(tx);
      const identity = { actorId: access.userId, operation: action, key };
      const claimed = await tx.idempotencyKey.createMany({
        data: { ...identity, requestDigest, expiresAt: new Date(now.valueOf() + 24 * 60 * 60 * 1000) },
        skipDuplicates: true,
      });
      const where = { actorId_operation_key: identity };
      // INSERT may wait for the first attempt to commit. Check expiry and scope on either path.
      await this.sessions.authorize(tx, access, [action]);
      await input.scope?.(tx);
      if (!claimed.count) {
        const record = await tx.idempotencyKey.findUniqueOrThrow({ where });
        if (record.requestDigest !== requestDigest) throw failure(409, 'IDEMPOTENCY_KEY_REUSED');
        if (record.expiresAt <= await databaseTime(tx)) throw failure(409, 'IDEMPOTENCY_KEY_EXPIRED');
        if (record.resultStatus === null) throw failure(503, 'RETRY_TRANSACTION');
        return { status: record.resultStatus, reference: record.resultReference, executed: false };
      }
      const outcome = await input.write(tx);
      await tx.idempotencyKey.update({ where, data: { resultStatus: outcome.status, resultReference: outcome.reference } });
      return { ...outcome, executed: true };
    });
  }
}
