import { Inject, Injectable } from '@nestjs/common';
import { AuditAction, AuditTarget, BookingStatus, Prisma, Role } from '@prisma/client';
import { AccessContext, lockIdentity, Sessions } from '../identity/session.service';
import { audit } from '../platform/audit';
import { Commands } from '../platform/commands';
import { CONFIG, Config } from '../platform/config';
import { Database, databaseTime, Transaction } from '../platform/database';
import { failure } from '../platform/http';
import { AttendanceDetailDto, AttendanceHistoryDto, AttendanceQuery, ReaffirmAttendanceDto, ReturnAttendanceDto, SubmitAttendanceDto } from './attendance.dto';

const read = 'attendance.read';
const submit = 'attendance.submit';
const returnAttendance = 'attendance.return';
const reaffirm = 'attendance.reaffirm';

const decisionFields = { id: true, adminId: true, decision: true, reason: true, decidedAt: true } satisfies Prisma.AttendanceReviewDecisionSelect;

const sessionFields = {
  id: true, startsAt: true, endsAt: true, revision: true, cancelledAt: true, coachId: true, sessionTypeId: true,
  coach: { select: { displayName: true } }, sessionType: { select: { name: true } },
  attendance: { select: {
    servedCoachId: true, servedStartsAt: true, servedSessionTypeId: true,
    servedCoach: { select: { displayName: true } }, servedSessionType: { select: { name: true } },
  } },
} satisfies Prisma.ScheduledSessionSelect;

const latestRevision = {
  orderBy: { revision: 'desc' },
  take: 1,
  select: { id: true, revision: true, outcome: true, submittedAt: true, reviewDecision: { select: decisionFields } },
} satisfies Prisma.AttendanceRevisionFindManyArgs;

type WriteContext = { access: AccessContext; requestId: string; key?: string };

@Injectable()
export class AttendanceService {
  constructor(private readonly db: Database, private readonly commands: Commands, private readonly sessions: Sessions,
    @Inject(CONFIG) private readonly config: Config) {}

  detail(access: AccessContext, id: string, query: AttendanceQuery): Promise<AttendanceDetailDto> {
    const sessionId = id.toLowerCase();
    const after = query.after?.toLowerCase();
    const limit = query.limit ?? 50;
    return this.db.command(async tx => {
      await lockIdentity(tx, access.userId, access.sessionId);
      await this.lockSession(tx, sessionId, 'read');
      const { user } = await this.sessions.authorize(tx, access, [read]);
      const session = await this.session(tx, sessionId, user.role === Role.COACH ? access.userId : undefined);

      // A cancelled booking remains visible only if it already has attendance history.
      const where: Prisma.BookingWhereInput = {
        scheduledSessionId: sessionId,
        OR: [
          ...(!session.cancelledAt ? [{ status: BookingStatus.CONFIRMED }] : []),
          { attendanceParticipants: { some: {} } },
        ],
      };
      if (after && !await tx.booking.findFirst({ where: { ...where, id: after }, select: { id: true } })) {
        throw failure(400, 'INVALID_ATTENDANCE_CURSOR');
      }
      const rows = await tx.booking.findMany({
        where: { ...where, ...(after ? { id: { gt: after } } : {}) },
        orderBy: { id: 'asc' }, take: limit + 1,
        select: {
          id: true, status: true, client: { select: { displayName: true } },
          attendanceParticipants: { select: { revisions: latestRevision } },
        },
      });
      const served = session.attendance;
      return {
        session: {
          id: session.id, sessionTypeId: session.sessionTypeId, sessionTypeName: session.sessionType.name,
          coach: { id: session.coachId, displayName: session.coach.displayName },
          startsAt: session.startsAt, endsAt: session.endsAt, revision: session.revision, cancelledAt: session.cancelledAt,
          served: served ? {
            coachId: served.servedCoachId, coachDisplayName: served.servedCoach.displayName, startsAt: served.servedStartsAt,
            sessionTypeId: served.servedSessionTypeId, sessionTypeName: served.servedSessionType.name,
          } : null,
        },
        serverTime: await databaseTime(tx),
        submissionEnabled: user.role === Role.COACH && this.config.attendanceCaptureForTesting === true,
        returnEnabled: user.role === Role.ADMIN && this.config.attendanceCaptureForTesting === true,
        items: rows.slice(0, limit).map(row => {
          const revision = row.attendanceParticipants[0]?.revisions[0];
          return {
            bookingId: row.id, clientDisplayName: row.client.displayName,
            bookingStatus: row.status === BookingStatus.CONFIRMED ? BookingStatus.CONFIRMED : BookingStatus.CANCELLED,
            revision: revision?.revision ?? 0, outcome: revision?.outcome ?? null,
            reviewStatus: revision?.reviewDecision ? 'RETURNED' : revision ? 'PENDING_REVIEW' : 'UNSUBMITTED',
            submittedAt: revision?.submittedAt ?? null,
          };
        }),
        nextCursor: rows.length > limit ? rows[limit - 1].id : null,
      };
    });
  }

  history(access: AccessContext, id: string, participantId: string, query: AttendanceQuery): Promise<AttendanceHistoryDto> {
    const sessionId = id.toLowerCase();
    const bookingId = participantId.toLowerCase();
    const after = query.after?.toLowerCase();
    const limit = query.limit ?? 50;
    return this.db.command(async tx => {
      await lockIdentity(tx, access.userId, access.sessionId);
      await this.lockSession(tx, sessionId, 'read');
      const { user } = await this.sessions.authorize(tx, access, [read]);
      await this.session(tx, sessionId, user.role === Role.COACH ? access.userId : undefined);
      const participant = await tx.attendanceParticipant.findFirst({ where: { bookingId, scheduledSessionId: sessionId } });
      if (!participant) throw failure(404, 'BOOKING_NOT_FOUND');
      const cursor = after ? await tx.attendanceRevision.findFirst({ where: { id: after, bookingId }, select: { revision: true } }) : null;
      if (after && !cursor) throw failure(400, 'INVALID_ATTENDANCE_CURSOR');
      const rows = await tx.attendanceRevision.findMany({
        where: { bookingId, ...(cursor ? { revision: { lt: cursor.revision } } : {}) },
        orderBy: { revision: 'desc' }, take: limit + 1,
        select: { ...latestRevision.select, submittedById: true },
      });
      return {
        bookingId,
        items: rows.slice(0, limit).map(row => ({ ...row, submissionKind: row.revision === 1 ? 'ORIGINAL' : 'REAFFIRMATION' })),
        nextCursor: rows.length > limit ? rows[limit - 1].id : null,
      };
    });
  }

  async returnForCorrection(ctx: WriteContext, id: string, participantId: string, dto: ReturnAttendanceDto) {
    const sessionId = id.toLowerCase();
    const bookingId = participantId.toLowerCase();
    await this.commands.run({
      ...ctx, action: returnAttendance, args: [sessionId, bookingId, dto.expectedScheduleRevision, dto.expectedRevision, dto.reason],
      scope: async tx => {
        await this.lockSession(tx, sessionId, 'write');
        await this.sessions.authorize(tx, ctx.access, [returnAttendance]);
        await this.session(tx, sessionId);
      },
      write: async tx => {
        const { revision, now } = await this.currentParticipant(tx, sessionId, bookingId, dto);
        if (!revision || revision.reviewDecision) throw failure(409, 'ATTENDANCE_STATE_CONFLICT');
        const decision = await tx.attendanceReviewDecision.create({ data: {
          revisionId: revision.id, adminId: ctx.access.userId, decision: 'RETURNED', reason: dto.reason, decidedAt: now,
        } });
        await audit(tx, {
          actorId: ctx.access.userId, requestId: ctx.requestId, action: AuditAction.ATTENDANCE_RETURNED,
          targetType: AuditTarget.ATTENDANCE_REVIEW_DECISION, targetId: decision.id, reason: dto.reason,
          redactedDetails: { scheduledSessionId: sessionId, bookingId, revisionId: revision.id, revision: revision.revision },
        });
        return { status: 204 };
      },
    });
  }

  async reaffirm(ctx: WriteContext, id: string, participantId: string, dto: ReaffirmAttendanceDto) {
    const sessionId = id.toLowerCase();
    const bookingId = participantId.toLowerCase();
    const reviewedReturnId = dto.reviewedReturnId.toLowerCase();
    await this.commands.run({
      ...ctx, action: reaffirm,
      args: [sessionId, bookingId, dto.expectedScheduleRevision, dto.expectedRevision, reviewedReturnId, dto.outcome],
      scope: async tx => {
        await this.lockSession(tx, sessionId, 'write');
        await this.sessions.authorize(tx, ctx.access, [reaffirm]);
        await this.session(tx, sessionId, ctx.access.userId);
      },
      write: async tx => {
        const { revision, now } = await this.currentParticipant(tx, sessionId, bookingId, dto, ctx.access.userId);
        if (!revision?.reviewDecision || revision.revision === 2_147_483_647) throw failure(409, 'ATTENDANCE_STATE_CONFLICT');
        if (revision.reviewDecision.id !== reviewedReturnId) throw failure(409, 'ATTENDANCE_RETURN_STALE');
        const next = await tx.attendanceRevision.create({ data: {
          bookingId, revision: revision.revision + 1, outcome: dto.outcome, submittedById: ctx.access.userId, submittedAt: now,
        } });
        await audit(tx, {
          actorId: ctx.access.userId, requestId: ctx.requestId, action: AuditAction.ATTENDANCE_REAFFIRMED,
          targetType: AuditTarget.ATTENDANCE_REVISION, targetId: next.id,
          redactedDetails: { scheduledSessionId: sessionId, bookingId, revision: next.revision, outcome: next.outcome,
            previousRevisionId: revision.id, reviewedReturnId },
        });
        return { status: 204 };
      },
    });
  }

  private async currentParticipant(tx: Transaction, sessionId: string, bookingId: string,
    dto: { expectedScheduleRevision: number; expectedRevision: number }, coachId?: string) {
    if (this.config.attendanceCaptureForTesting !== true) throw failure(409, 'WORKFLOW_NOT_ENABLED');
    const session = await this.session(tx, sessionId, coachId);
    const booking = await tx.booking.findFirst({
      where: { id: bookingId, scheduledSessionId: sessionId },
      select: { status: true, attendanceParticipants: { select: { revisions: latestRevision } } },
    });
    const now = await databaseTime(tx);
    if (session.cancelledAt) throw failure(409, 'SESSION_CANCELLED');
    if (session.revision !== dto.expectedScheduleRevision) throw failure(409, 'SCHEDULED_SESSION_CHANGED');
    if (now < session.startsAt) throw failure(409, 'SESSION_NOT_STARTED');
    if (!booking) throw failure(404, 'BOOKING_NOT_FOUND');
    // O-09-E has no approved review policy for cancelled bookings; preserve evidence and block new transitions.
    if (booking.status !== BookingStatus.CONFIRMED) throw failure(409, 'BOOKING_NOT_CONFIRMED');
    const revision = booking.attendanceParticipants[0]?.revisions[0];
    if ((revision?.revision ?? 0) !== dto.expectedRevision) throw failure(409, 'ATTENDANCE_REVISION_STALE');
    return { revision, now };
  }

  async submit(ctx: WriteContext, id: string, dto: SubmitAttendanceDto) {
    const sessionId = id.toLowerCase();
    const { expectedScheduleRevision } = dto;
    const entries = dto.entries.map(({ bookingId, expectedRevision, outcome }) => ({
      bookingId: bookingId.toLowerCase(), expectedRevision, outcome,
    })).sort((a, b) => a.bookingId.localeCompare(b.bookingId));
    const bookingIds = entries.map(entry => entry.bookingId);
    if (new Set(bookingIds).size !== entries.length) throw failure(400, 'INVALID_INPUT');

    await this.commands.run({
      ...ctx, action: submit, args: [sessionId, expectedScheduleRevision, entries],
      scope: async tx => {
        await this.lockSession(tx, sessionId, 'write');
        await this.sessions.authorize(tx, ctx.access, [submit]);
        await this.session(tx, sessionId, ctx.access.userId);
      },
      write: async tx => {
        if (this.config.attendanceCaptureForTesting !== true) throw failure(409, 'WORKFLOW_NOT_ENABLED');

        const session = await this.session(tx, sessionId, ctx.access.userId);
        const bookings = await tx.booking.findMany({
          where: { id: { in: bookingIds }, scheduledSessionId: sessionId },
          select: { id: true, status: true, attendanceParticipants: { select: { revisions: latestRevision } } },
        });
        const now = await databaseTime(tx);
        if (session.cancelledAt) throw failure(409, 'SESSION_CANCELLED');
        if (session.revision !== expectedScheduleRevision) throw failure(409, 'SCHEDULED_SESSION_CHANGED');
        if (now < session.startsAt) throw failure(409, 'SESSION_NOT_STARTED');
        if (bookings.length !== entries.length) throw failure(404, 'BOOKING_NOT_FOUND');

        const roster = new Map(bookings.map(row => [row.id, row]));
        for (const { bookingId, expectedRevision } of entries) {
          const booking = roster.get(bookingId)!;
          if (booking.status !== BookingStatus.CONFIRMED) throw failure(409, 'BOOKING_NOT_CONFIRMED');
          const revision = booking.attendanceParticipants[0]?.revisions[0]?.revision ?? 0;
          if (expectedRevision !== revision) throw failure(409, 'ATTENDANCE_REVISION_STALE');
          if (revision !== 0) throw failure(409, 'ATTENDANCE_STATE_CONFLICT');
        }

        if (!session.attendance) {
          await tx.sessionAttendance.create({ data: {
            scheduledSessionId: sessionId, servedCoachId: session.coachId, servedStartsAt: session.startsAt,
            servedSessionTypeId: session.sessionTypeId,
          } });
        }
        await tx.attendanceParticipant.createMany({
          data: bookingIds.map(bookingId => ({ bookingId, scheduledSessionId: sessionId })),
        });
        for (const { bookingId, outcome } of entries) {
          const revision = await tx.attendanceRevision.create({
            data: { bookingId, revision: 1, outcome, submittedById: ctx.access.userId, submittedAt: now },
            select: { id: true },
          });
          await audit(tx, {
            actorId: ctx.access.userId, requestId: ctx.requestId, action: AuditAction.ATTENDANCE_SUBMITTED,
            targetType: AuditTarget.ATTENDANCE_REVISION, targetId: revision.id,
            redactedDetails: { scheduledSessionId: sessionId, bookingId, revision: 1, outcome },
          });
        }
        return { status: 204 };
      },
    });
  }

  private async session(tx: Transaction, id: string, coachId?: string) {
    const session = await tx.scheduledSession.findUnique({ where: { id }, select: sessionFields });
    if (!session || (coachId && (session.coachId !== coachId || (session.attendance && session.attendance.servedCoachId !== coachId)))) {
      throw failure(404, 'SCHEDULED_SESSION_NOT_FOUND');
    }
    return session;
  }

  private async lockSession(tx: Transaction, sessionId: string, mode: 'read' | 'write') {
    // Booking and Scheduling writers lock this row before changing the roster or assignment.
    const lock = mode === 'read' ? Prisma.sql`FOR SHARE` : Prisma.sql`FOR NO KEY UPDATE`;
    await tx.$queryRaw`SELECT id FROM scheduled_session WHERE id = ${sessionId}::uuid ${lock}`;
  }
}
