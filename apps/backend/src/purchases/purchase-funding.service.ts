import { Injectable } from '@nestjs/common';
import { Prisma, PurchaseType } from '@prisma/client';
import { Database, Transaction } from '../platform/database';
import { AccessContext, lockIdentity, Sessions } from '../identity/session.service';
import { failure } from '../platform/http';
import { PurchaseAuditEventDto, PurchaseAuditQuery } from './purchase-audit.dto';
import { PurchaseFundingDto } from './purchase-funding.dto';

@Injectable()
export class PurchaseFundingService {
  constructor(private readonly db: Database, private readonly sessions: Sessions) {}

  async summary(purchaseId: string, db: Transaction = this.db): Promise<PurchaseFundingDto> {
    const [purchase] = await db.$queryRaw<{
      id: string; type: PurchaseType; price: string | null; currency: string | null; allocated: Prisma.Decimal;
    }[]>`
      SELECT p.id, p.type,
        CASE WHEN jsonb_typeof(p.terms->'price') = 'string' THEN p.terms->>'price' END AS price,
        p.terms->>'currency' AS currency,
        (SELECT COALESCE(SUM(a.amount), 0) FROM payment_allocation a WHERE a.purchase_id = p.id) AS allocated
      FROM purchase p WHERE p.id = ${purchaseId}::uuid`;
    if (!purchase) throw failure(404, 'PURCHASE_NOT_FOUND');
    if (purchase.currency !== 'SAR' || purchase.price === null || !/^(?:0|[1-9][0-9]{0,14})\.[0-9]{2}$/.test(purchase.price)) {
      throw failure(500, 'INTERNAL_ERROR');
    }

    const price = new Prisma.Decimal(purchase.price);
    if (price.isZero() !== (purchase.type === PurchaseType.COMPLIMENTARY)) {
      throw failure(500, 'INTERNAL_ERROR');
    }
    const remaining = price.minus(purchase.allocated);
    if (remaining.isNegative()) throw failure(409, 'PURCHASE_OVERFUNDED');
    return {
      purchaseId: purchase.id,
      currency: purchase.currency,
      purchasePrice: price.toFixed(2),
      allocatedAmount: purchase.allocated.toFixed(2),
      remainingAmount: remaining.toFixed(2),
      fundingStatus: remaining.isZero() ? 'FULLY_FUNDED' : purchase.allocated.isZero() ? 'UNFUNDED' : 'PARTIALLY_FUNDED',
    };
  }
  async audit(access: AccessContext, purchaseId: string, query: PurchaseAuditQuery) {
    return this.db.command(async tx => {
      await lockIdentity(tx, access.userId, access.sessionId);
      // Sessions.authorize treats an action array as OR; these permissions are conjunctive.
      await this.sessions.authorize(tx, access, ['purchase.funding.read']);
      await this.sessions.authorize(tx, access, ['audit.read']);
      if (!await tx.purchase.findUnique({ where: { id: purchaseId }, select: { id: true } })) {
        throw failure(404, 'PURCHASE_NOT_FOUND');
      }
      const related = Prisma.sql`(
        (a.target_type = 'PURCHASE' AND a.action = 'PURCHASE_ACCEPTED_RECORDED' AND a.target_id = ${purchaseId}::uuid)
        OR (a.target_type = 'PAYMENT' AND a.action IN ('PAYMENT_RECORDED', 'PAYMENT_VERIFIED') AND EXISTS (
          SELECT 1 FROM payment_allocation x WHERE x.purchase_id = ${purchaseId}::uuid AND x.payment_id = a.target_id))
        OR (a.target_type = 'PAYMENT_ALLOCATION' AND a.action = 'PAYMENT_ALLOCATED' AND EXISTS (
          SELECT 1 FROM payment_allocation x WHERE x.purchase_id = ${purchaseId}::uuid AND x.id = a.target_id))
        OR (a.target_type = 'MEMBERSHIP' AND a.action = 'MEMBERSHIP_ACTIVATED' AND EXISTS (
          SELECT 1 FROM membership m WHERE m.purchase_id = ${purchaseId}::uuid AND m.id = a.target_id))
      )`;
      const [anchor] = query.after ? await tx.$queryRaw<{ createdAt: Date; id: string }[]>`
        SELECT a.created_at AS "createdAt", a.id FROM audit_log a
        WHERE ${related} AND a.id = ${query.after}::uuid` : [];
      if (query.after && !anchor) throw failure(400, 'INVALID_PURCHASE_AUDIT_CURSOR');
      const rows = await tx.$queryRaw<PurchaseAuditEventDto[]>`
        SELECT a.id, a.created_at AS "createdAt", a.actor_id AS "actorId", a.action,
          a.target_type AS "targetType", a.target_id AS "targetId", a.request_id AS "requestId", a.reason
        FROM audit_log a WHERE ${related}
          ${anchor ? Prisma.sql`AND (a.created_at, a.id) < (SELECT x.created_at, x.id FROM audit_log x WHERE x.id = ${anchor.id}::uuid)` : Prisma.empty}
        ORDER BY a.created_at DESC, a.id DESC LIMIT ${query.limit + 1}`;
      const items = rows.slice(0, query.limit);
      return { items, nextCursor: rows.length > query.limit ? items[items.length - 1].id : null };
    });
  }
}
