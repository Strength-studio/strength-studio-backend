import { Injectable } from '@nestjs/common';
import { AuditAction, AuditTarget, BookingStatus, MembershipStatus, PackageKind, Prisma, Role } from '@prisma/client';
import { AccessContext, Sessions } from '../identity/session.service';
import { audit } from '../platform/audit';
import { Commands } from '../platform/commands';
import { Database, databaseTime, Transaction } from '../platform/database';
import { failure } from '../platform/http';
import { dateOnly, riyadhDate } from '../platform/riyadh-calendar';
import { BookingListQuery, BookingMembershipDto, BookingPageDto, CreateBookingDto, MembershipReason } from './booking.dto';

type WriteContext = { access: AccessContext; requestId: string; key?: string };

const membershipFields = {
  id: true, status: true, validFrom: true, validThrough: true, initialSessionAllowance: true,
  purchase: { select: { clientId: true, terms: true } },
} satisfies Prisma.MembershipSelect;

const sessionFields = {
  id: true, startsAt: true, endsAt: true, cancelledAt: true, sessionTypeId: true, capacity: true,
  sessionType: { select: { name: true } }, coach: { select: { userId: true, displayName: true } },
} satisfies Prisma.ScheduledSessionSelect;

type Membership = Prisma.MembershipGetPayload<{ select: typeof membershipFields }>;
type Session = Prisma.ScheduledSessionGetPayload<{ select: typeof sessionFields }>;

const confirmed = { status: BookingStatus.CONFIRMED };
const activeCommitment = { ...confirmed, scheduledSession: { cancelledAt: null } };
const decisions = {
  approve: { action: 'booking.approve', status: BookingStatus.CONFIRMED, event: AuditAction.BOOKING_APPROVED },
  reject: { action: 'booking.approve', status: BookingStatus.REJECTED, event: AuditAction.BOOKING_REJECTED },
  cancel: { action: 'booking.cancel.decide', status: BookingStatus.CANCELLED, event: AuditAction.BOOKING_CANCELLED },
} as const;

function jsonObject(value: Prisma.JsonValue): Prisma.JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function terms(membership: Membership) {
  const { name, kind, sessionTypes } = jsonObject(membership.purchase.terms);
  return {
    packageLabel: typeof name === 'string' ? name : null,
    packageKind: kind === PackageKind.TIME || kind === PackageKind.SESSION ? kind : null,
    sessionTypes: Array.isArray(sessionTypes) ? sessionTypes.map(type => jsonObject(type).id) : [],
  };
}

function coverage(membership: Membership, session: Session): MembershipReason | null {
  if (membership.status !== MembershipStatus.ACTIVE || !membership.validFrom || !membership.validThrough) {
    return 'MEMBERSHIP_INACTIVE';
  }
  // Sessions are half-open intervals, so an end at midnight still fits the preceding day.
  const lastServiceDay = riyadhDate(new Date(session.endsAt.valueOf() - 1));
  if (riyadhDate(session.startsAt) < dateOnly(membership.validFrom) || lastServiceDay > dateOnly(membership.validThrough)) {
    return 'OUTSIDE_VALIDITY';
  }
  const { packageKind, sessionTypes } = terms(membership);
  if (!packageKind || !sessionTypes.includes(session.sessionTypeId)) return 'SESSION_TYPE_NOT_ALLOWED';
  return null;
}

function choice(membership: Membership, session: Session, now: Date, commitments: number): BookingMembershipDto {
  const { packageLabel, packageKind } = terms(membership);
  const { id: membershipId, validFrom, validThrough } = membership;
  const initialSessionAllowance = packageKind === PackageKind.SESSION ? membership.initialSessionAllowance : null;
  const remainingCommitments = initialSessionAllowance === null ? null : Math.max(0, initialSessionAllowance - commitments);
  const expired = validThrough && riyadhDate(now) > dateOnly(validThrough);
  const reason = session.cancelledAt ? 'SESSION_CANCELLED'
    : expired ? 'MEMBERSHIP_EXPIRED'
    : coverage(membership, session)
      ?? (packageKind === PackageKind.SESSION && !remainingCommitments ? 'ALLOWANCE_EXHAUSTED' : null);
  return {
    membershipId, packageLabel, packageKind, validFrom: validFrom && dateOnly(validFrom), validThrough: validThrough && dateOnly(validThrough),
    eligible: reason === null, reason, initialSessionAllowance,
    confirmedCommitments: packageKind === PackageKind.SESSION ? commitments : null, remainingCommitments,
  };
}

@Injectable()
export class BookingService {
  constructor(private readonly db: Database, private readonly commands: Commands, private readonly sessions: Sessions) {}

  list(query: BookingListQuery): Promise<BookingPageDto> {
    const scheduledSessionId = query.scheduledSessionId.toLowerCase();
    const after = query.after?.toLowerCase();
    const limit = query.limit ?? 50;
    return this.db.$transaction(async tx => {
      const session = await this.session(tx, scheduledSessionId);
      if (after && !await tx.booking.findFirst({ where: { id: after, scheduledSessionId }, select: { id: true } })) {
        throw failure(400, 'INVALID_BOOKING_CURSOR');
      }
      const rows = await tx.booking.findMany({
        where: { scheduledSessionId }, take: limit + 1,
        ...(after ? { cursor: { id: after }, skip: 1 } : {}),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true, clientId: true, scheduledSessionId: true, membershipId: true, status: true, createdAt: true, updatedAt: true,
          client: { select: { displayName: true } }, membership: { select: membershipFields },
        },
      });
      const items = rows.slice(0, limit).map(({ client, membership, ...row }) => ({
        ...row, clientDisplayName: client.displayName, packageLabel: terms(membership).packageLabel,
        requiresReview: !session.cancelledAt && row.status === BookingStatus.CONFIRMED && coverage(membership, session) !== null,
      }));
      return {
        session: {
          id: session.id, sessionTypeId: session.sessionTypeId, sessionTypeName: session.sessionType.name,
          coach: { id: session.coach.userId, displayName: session.coach.displayName },
          startsAt: session.startsAt, endsAt: session.endsAt, capacity: session.capacity,
          status: session.cancelledAt ? 'CANCELLED' : 'SCHEDULED', confirmedBookingCount: await this.occupied(tx, session),
        },
        items, nextCursor: rows.length > limit ? items[limit - 1].id : null,
      };
    }, { isolationLevel: 'RepeatableRead' });
  }

  choices(clientId: string, scheduledSessionId: string) {
    return this.db.$transaction(async tx => {
      await this.requireClient(tx, clientId);
      const session = await this.session(tx, scheduledSessionId);
      const memberships = await tx.membership.findMany({
        where: { purchase: { clientId } }, select: membershipFields, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      const sessionMembershipIds = memberships.filter(row => terms(row).packageKind === PackageKind.SESSION).map(row => row.id);
      const counts = sessionMembershipIds.length ? await tx.booking.groupBy({
        by: ['membershipId'], where: { ...activeCommitment, membershipId: { in: sessionMembershipIds } }, _count: { _all: true },
      }) : [];
      const commitments = new Map(counts.map(row => [row.membershipId, row._count._all]));
      const now = await databaseTime(tx);
      return memberships.map(row => choice(row, session, now, commitments.get(row.id) ?? 0));
    }, { isolationLevel: 'RepeatableRead' });
  }

  async create(ctx: WriteContext, dto: CreateBookingDto) {
    const clientId = dto.clientId.toLowerCase();
    const scheduledSessionId = dto.scheduledSessionId.toLowerCase();
    const membershipId = dto.membershipId.toLowerCase();
    const action = 'booking.assist';
    const result = await this.commands.run({
      ...ctx, action, args: [clientId, scheduledSessionId, membershipId],
      write: async tx => {
        await this.lock(tx, membershipId, scheduledSessionId);
        await this.sessions.authorize(tx, ctx.access, [action]);
        await this.requireClient(tx, clientId);
        const session = await this.session(tx, scheduledSessionId);
        if (session.cancelledAt) throw failure(409, 'SESSION_CANCELLED');
        const duplicate = await tx.booking.findFirst({
          where: { clientId, scheduledSessionId, status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] } }, select: { id: true },
        });
        if (duplicate) throw failure(409, 'BOOKING_ALREADY_EXISTS');
        const now = await databaseTime(tx);
        await this.requireAvailability(tx, session, clientId, membershipId, now);
        const [booking] = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO booking (client_id, scheduled_session_id, membership_id, created_at, updated_at)
          VALUES (${clientId}::uuid, ${scheduledSessionId}::uuid, ${membershipId}::uuid, ${now}, ${now})
          ON CONFLICT (client_id, scheduled_session_id) WHERE status IN ('PENDING', 'CONFIRMED') DO NOTHING
          RETURNING id`;
        if (!booking) throw failure(409, 'BOOKING_ALREADY_EXISTS');
        await audit(tx, {
          actorId: ctx.access.userId, requestId: ctx.requestId, action: AuditAction.BOOKING_CREATED,
          targetType: AuditTarget.BOOKING, targetId: booking.id,
          redactedDetails: { clientId, scheduledSessionId, membershipId, previousStatus: null, status: BookingStatus.PENDING },
        });
        return { status: 201, reference: booking.id };
      },
    });
    return { bookingId: result.reference!, status: BookingStatus.PENDING };
  }

  async decide(ctx: WriteContext, id: string, decision: keyof typeof decisions, reason?: string) {
    if (decision !== 'approve' && !reason?.trim()) throw failure(400, 'INVALID_INPUT');
    const bookingId = id.toLowerCase();
    const { action, status, event } = decisions[decision];
    await this.commands.run({
      ...ctx, action, operation: 'booking.' + decision, args: [bookingId, reason],
      write: async tx => {
        // The routing references are immutable. Read the lifecycle status after acquiring both locks.
        const references = await tx.booking.findUnique({
          where: { id: bookingId }, select: { membershipId: true, scheduledSessionId: true, clientId: true },
        });
        if (!references) throw failure(404, 'BOOKING_NOT_FOUND');
        const { membershipId, scheduledSessionId, clientId } = references;
        await this.lock(tx, membershipId, scheduledSessionId);
        await this.sessions.authorize(tx, ctx.access, [action]);
        const { status: previousStatus } = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { status: true } });
        if (previousStatus !== BookingStatus.PENDING && !(decision === 'cancel' && previousStatus === BookingStatus.CONFIRMED)) {
          throw failure(409, 'BOOKING_STATE_CONFLICT');
        }
        const now = await databaseTime(tx);
        if (decision === 'approve') {
          await this.requireClient(tx, clientId);
          const session = await this.session(tx, scheduledSessionId);
          await this.requireAvailability(tx, session, clientId, membershipId, now);
        }
        await tx.booking.update({ where: { id: bookingId }, data: { status, updatedAt: now }, select: { id: true } });
        await audit(tx, {
          actorId: ctx.access.userId, requestId: ctx.requestId, action: event,
          targetType: AuditTarget.BOOKING, targetId: bookingId, reason, redactedDetails: { previousStatus, status },
        });
        return { status: 204 };
      },
    });
  }

  private async lock(tx: Transaction, membershipId: string, scheduledSessionId: string) {
    // This order serializes membership commitments across sessions, then coordinates with Scheduling's session lock.
    await tx.$queryRaw`SELECT id FROM membership WHERE id = ${membershipId}::uuid FOR NO KEY UPDATE`;
    await tx.$queryRaw`SELECT id FROM scheduled_session WHERE id = ${scheduledSessionId}::uuid FOR NO KEY UPDATE`;
  }

  private async requireClient(tx: Transaction, userId: string) {
    if (!await tx.clientProfile.findFirst({ where: { userId, user: { role: Role.CLIENT } }, select: { userId: true } })) {
      throw failure(404, 'CLIENT_NOT_FOUND');
    }
  }

  private async session(tx: Transaction, id: string) {
    const row = await tx.scheduledSession.findUnique({ where: { id }, select: sessionFields });
    if (!row) throw failure(404, 'SCHEDULED_SESSION_NOT_FOUND');
    return row;
  }

  private occupied(tx: Transaction, session: Session) {
    return session.cancelledAt ? 0 : tx.booking.count({ where: { ...confirmed, scheduledSessionId: session.id } });
  }

  private async requireAvailability(tx: Transaction, session: Session, clientId: string, membershipId: string, now: Date) {
    if (session.cancelledAt) throw failure(409, 'SESSION_CANCELLED');
    const membership = await tx.membership.findUnique({ where: { id: membershipId }, select: membershipFields });
    if (!membership || membership.purchase.clientId !== clientId) throw failure(409, 'MEMBERSHIP_NOT_ELIGIBLE');
    const commitments = terms(membership).packageKind === PackageKind.SESSION
      ? await tx.booking.count({ where: { ...activeCommitment, membershipId } }) : 0;
    if (!choice(membership, session, now, commitments).eligible) throw failure(409, 'MEMBERSHIP_NOT_ELIGIBLE');
    if (await this.occupied(tx, session) >= session.capacity) throw failure(409, 'SLOT_FULL');
  }
}
