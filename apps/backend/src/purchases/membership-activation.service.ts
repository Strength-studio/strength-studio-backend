import { Injectable } from '@nestjs/common';
import { AuditAction, AuditTarget, MembershipStatus, Prisma, PurchaseType } from '@prisma/client';
import { AccessContext, Sessions } from '../identity/session.service';
import { audit } from '../platform/audit';
import { Commands } from '../platform/commands';
import { Database, databaseTime } from '../platform/database';
import { failure } from '../platform/http';
import { ActivateMembershipDto, MembershipActivationDto, MembershipActivationStateDto } from './membership-activation.dto';
import { PurchaseFundingService } from './purchase-funding.service';

const action = 'membership.activate';
const riyadhCalendar = new Intl.DateTimeFormat('en-CA', { dateStyle: 'short', timeZone: 'Asia/Riyadh' });
const dateOnly = (date: Date) => date.toISOString().slice(0, 10);

export function membershipValidity(activatedAt: Date, validityDays: number) {
  const validFrom = new Date(riyadhCalendar.format(activatedAt) + 'T00:00:00Z');
  const validThrough = new Date(validFrom);
  validThrough.setUTCDate(validThrough.getUTCDate() + validityDays - 1);
  if (!Number.isFinite(validThrough.valueOf()) || validThrough.getUTCFullYear() > 9999) {
    throw failure(409, 'PURCHASE_VALIDITY_OUT_OF_RANGE');
  }
  return { validFrom, validThrough };
}

function frozenTerms(terms: Prisma.JsonValue) {
  if (terms === null || typeof terms !== 'object' || Array.isArray(terms)) return null;
  const { kind, validityDays, sessionAllowance } = terms;
  const positiveInt = (value: unknown): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2_147_483_647;
  if (!positiveInt(validityDays)) return null;
  if (kind === 'TIME' && sessionAllowance === null) return { validityDays, initialSessionAllowance: null };
  if (kind === 'SESSION' && positiveInt(sessionAllowance)) return { validityDays, initialSessionAllowance: sessionAllowance };
  return null;
}

function eligibility(purchase: { type: PurchaseType; acceptance: { id: string } | null; terms: Prisma.JsonValue },
  membership: { id: string; status: MembershipStatus; validThrough: Date | null } | null, now: Date):
  MembershipActivationStateDto['status'] {
  if (membership?.status === MembershipStatus.ACTIVE && membership.validThrough) {
    const today = riyadhCalendar.format(now);
    return today > dateOnly(membership.validThrough) ? 'EXPIRED' : 'ACTIVE';
  }
  if (!purchase.acceptance || !frozenTerms(purchase.terms)) return 'INELIGIBLE';
  if (membership) return membership.status === MembershipStatus.PENDING_ACTIVATION ? 'PENDING_ACTIVATION' : 'INELIGIBLE';
  return purchase.type === PurchaseType.POSITIVE_PRICE ? 'NOT_CREATED' : 'INELIGIBLE';
}

@Injectable()
export class MembershipActivationService {
  constructor(private readonly db: Database, private readonly commands: Commands,
    private readonly sessions: Sessions, private readonly funding: PurchaseFundingService) {}

  async state(purchaseId: string): Promise<MembershipActivationStateDto> {
    const purchase = await this.db.purchase.findUnique({
      where: { id: purchaseId },
      select: { type: true, terms: true, acceptance: { select: { id: true } },
        membership: { select: { id: true, status: true, validThrough: true } } },
    });
    if (!purchase) throw failure(404, 'PURCHASE_NOT_FOUND');
    return { membershipId: purchase.membership?.id ?? null,
      status: eligibility(purchase, purchase.membership, await databaseTime(this.db)) };
  }

  async activate(access: AccessContext, requestId: string, key: string | undefined, id: string, dto: ActivateMembershipDto):
    Promise<MembershipActivationDto> {
    const purchaseId = id.toLowerCase();
    const reason = dto.overrideReason?.trim();
    const outcome = await this.commands.run({
      access, action, key, args: [purchaseId, dto.override, dto.overrideReason],
      write: async tx => {
        const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
          SELECT public.lock_purchase_for_activation(${purchaseId}::uuid) AS locked`;
        if (!locked) throw failure(404, 'PURCHASE_NOT_FOUND');
        const [membership] = await tx.$queryRaw<{
          id: string; status: MembershipStatus; validThrough: Date | null;
        }[]>`
          SELECT id, status, valid_through AS "validThrough" FROM membership
          WHERE purchase_id = ${purchaseId}::uuid FOR UPDATE`;
        await this.sessions.authorize(tx, access, [action]);

        const purchase = await tx.purchase.findUniqueOrThrow({
          where: { id: purchaseId },
          select: { type: true, terms: true, acceptance: { select: { id: true } } },
        });
        const activatedAt = await databaseTime(tx);
        const state = eligibility(purchase, membership ?? null, activatedAt);
        if (state === 'ACTIVE' || state === 'EXPIRED') throw failure(409, 'MEMBERSHIP_ALREADY_ACTIVATED');
        const terms = frozenTerms(purchase.terms);
        if (state === 'INELIGIBLE' || !terms) throw failure(409, 'MEMBERSHIP_NOT_ELIGIBLE');
        const funding = await this.funding.summary(purchaseId, tx);
        const overrideUsed = funding.fundingStatus !== 'FULLY_FUNDED';
        if (overrideUsed && dto.override !== true) throw failure(409, 'ACTIVATION_OVERRIDE_REQUIRED');
        if (dto.override === true && (!reason || !/[\p{L}\p{N}]/u.test(reason))) {
          throw failure(400, 'ACTIVATION_OVERRIDE_REASON_REQUIRED');
        }
        if (dto.override !== true && dto.overrideReason !== undefined) throw failure(400, 'INVALID_INPUT');

        const { validFrom, validThrough } = membershipValidity(activatedAt, terms.validityDays);
        const data = { status: MembershipStatus.ACTIVE, activatedAt, validFrom, validThrough,
          initialSessionAllowance: terms.initialSessionAllowance };
        const { id: membershipId } = membership
          ? await tx.membership.update({ where: { id: membership.id }, data, select: { id: true } })
          : await tx.membership.create({ data: { ...data, purchaseId, createdAt: activatedAt }, select: { id: true } });
        const event = await audit(tx, {
          actorId: access.userId, targetId: membershipId, action: AuditAction.MEMBERSHIP_ACTIVATED,
          targetType: AuditTarget.MEMBERSHIP, requestId, reason: overrideUsed ? reason : undefined,
          redactedDetails: {
            purchaseId, membershipId, purchaseType: purchase.type, activatedAt: activatedAt.toISOString(),
            validFrom: dateOnly(validFrom), validThrough: dateOnly(validThrough),
            initialSessionAllowance: data.initialSessionAllowance, fundingStatus: funding.fundingStatus,
            allocatedAmount: funding.allocatedAmount, remainingAmount: funding.remainingAmount, overrideUsed,
          },
        });
        return { status: 200, reference: event.id };
      },
    });
    // Replay the immutable activation event, even if funding or membership eligibility has since changed.
    const event = await this.db.auditLog.findUniqueOrThrow({
      where: { id: outcome.reference! }, select: { redactedDetails: true, reason: true },
    });
    const details = event.redactedDetails as {
      purchaseId: string; membershipId: string; purchaseType: PurchaseType; activatedAt: string;
      validFrom: string; validThrough: string; initialSessionAllowance: number | null;
      fundingStatus: MembershipActivationDto['fundingStatus']; overrideUsed: boolean;
    };
    return {
      membership: { id: details.membershipId, purchaseId: details.purchaseId, status: 'ACTIVE', activatedAt: details.activatedAt,
        validFrom: details.validFrom, validThrough: details.validThrough, initialSessionAllowance: details.initialSessionAllowance },
      purchaseType: details.purchaseType, fundingStatus: details.fundingStatus, overrideUsed: details.overrideUsed,
      ...(event.reason === null ? {} : { overrideReason: event.reason }),
    };
  }
}
