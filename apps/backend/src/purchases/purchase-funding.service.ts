import { Injectable } from '@nestjs/common';
import { Prisma, PurchaseType } from '@prisma/client';
import { Database, Transaction } from '../platform/database';
import { failure } from '../platform/http';
import { PurchaseFundingDto } from './purchase-funding.dto';

@Injectable()
export class PurchaseFundingService {
  constructor(private readonly db: Database) {}

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
}
