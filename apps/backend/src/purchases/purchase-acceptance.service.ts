import { Injectable } from '@nestjs/common';
import { AuditAction, AuditTarget, Prisma, PurchaseType, Role } from '@prisma/client';
import { AccessContext, Sessions } from '../identity/session.service';
import { audit } from '../platform/audit';
import { Commands } from '../platform/commands';
import { Database, databaseTime } from '../platform/database';
import { failure } from '../platform/http';
import { AcceptPackageDto } from './purchase-acceptance.dto';

const action = 'purchase.accept_record';

@Injectable()
export class PurchaseAcceptanceService {
  constructor(private readonly db: Database, private readonly commands: Commands, private readonly sessions: Sessions) {}

  async acceptComplimentary(access: AccessContext, requestId: string, key: string | undefined, dto: AcceptPackageDto) {
    const acceptanceId = await this.record(PurchaseType.COMPLIMENTARY, access, requestId, key, dto);
    const membership = await this.db.membership.findFirstOrThrow({
      where: { purchase: { acceptance: { id: acceptanceId } } }, select: { id: true, status: true },
    });
    return { acceptanceId, membershipId: membership.id, status: membership.status };
  }

  async acceptPositivePrice(access: AccessContext, requestId: string, key: string | undefined, dto: AcceptPackageDto) {
    return { purchaseId: await this.record(PurchaseType.POSITIVE_PRICE, access, requestId, key, dto) };
  }

  private async record(type: PurchaseType, access: AccessContext, requestId: string, key: string | undefined, dto: AcceptPackageDto) {
    const complimentary = type === PurchaseType.COMPLIMENTARY;
    const operation = complimentary ? 'purchase.accept-complimentary' : 'purchase.accept-positive-price';
    const clientId = dto.clientId.toLowerCase();
    const packageId = dto.packageId.toLowerCase();
    const packageVersionId = dto.packageVersionId.toLowerCase();
    const { agreementMethod, agreementEvidence, purpose } = dto;
    const outcome = await this.commands.run({
      access, action, operation, key, targetUser: clientId,
      args: [clientId, packageId, packageVersionId, agreementMethod, agreementEvidence, purpose],
      scope: async tx => {
        const client = await tx.clientProfile.findFirst({
          where: { userId: clientId, user: { role: Role.CLIENT } }, select: { userId: true },
        });
        if (!client) throw failure(404, 'CLIENT_NOT_FOUND');
      },
      write: async tx => {
        // Catalog writes lock the parent before the version. Hold both through commit.
        const [offer] = await tx.$queryRaw<{ archived_at: Date | null }[]>`
          SELECT archived_at FROM package WHERE id = ${packageId}::uuid FOR SHARE`;
        const [version] = await tx.$queryRaw<{
          price: Prisma.Decimal; currency: string; published_at: Date | null; superseded_at: Date | null;
        }[]>`
          SELECT price, currency, published_at, superseded_at FROM package_version
          WHERE package_id = ${packageId}::uuid AND id = ${packageVersionId}::uuid FOR SHARE`;
        await this.sessions.authorize(tx, access, [action]);
        if (!offer || !version) throw failure(404, 'CATALOG_VERSION_NOT_FOUND');
        // The current catalog contains only public offers. Issued terms and eligibility are immutable.
        const eligiblePrice = complimentary ? version.currency === 'SAR' && version.price.isZero() : version.price.gt(0);
        if (offer.archived_at || !version.published_at || version.superseded_at || !eligiblePrice) {
          throw failure(409, 'CATALOG_VERSION_NOT_ELIGIBLE');
        }
        const [{ terms }] = await tx.$queryRaw<{ terms: Prisma.InputJsonObject }[]>`
          SELECT public.purchase_terms_for_version(${packageVersionId}::uuid) AS terms`;
        const acceptedAt = await databaseTime(tx);
        const purchase = await tx.purchase.create({
          data: {
            clientId, packageVersionId, type, acceptedById: access.userId,
            acceptedAt, createdAt: acceptedAt, terms,
            acceptance: { create: { agreementMethod, agreementEvidence, purpose } },
            membership: complimentary ? { create: { createdAt: acceptedAt } } : undefined,
          },
          select: { id: true, acceptance: { select: { id: true } } },
        }).catch(error => {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
            && Array.isArray(error.meta?.target) && error.meta.target.includes('package_version_id')) {
            throw failure(409, complimentary ? 'COMPLIMENTARY_ACCEPTANCE_EXISTS' : 'POSITIVE_PRICE_ACCEPTANCE_EXISTS');
          }
          throw error;
        });
        const acceptanceId = purchase.acceptance!.id;
        await audit(tx, {
          actorId: access.userId, requestId, targetId: complimentary ? acceptanceId : purchase.id,
          action: AuditAction.PURCHASE_ACCEPTED_RECORDED,
          targetType: complimentary ? AuditTarget.COMPLIMENTARY_ACCEPTANCE : AuditTarget.PURCHASE,
          redactedDetails: { packageVersionId, agreementMethod, ...(complimentary ? { purchaseId: purchase.id } : { acceptanceId }) },
        });
        // Keep acceptance IDs in replay records so pre-migration keys can return the original result.
        return { status: 201, reference: complimentary ? acceptanceId : purchase.id };
      },
    });

    return outcome.reference!;
  }
}
