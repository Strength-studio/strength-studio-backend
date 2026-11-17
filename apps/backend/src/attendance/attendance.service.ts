import { Inject, Injectable } from '@nestjs/common';
import { AuditAction, AuditTarget, BookingStatus, Prisma, Role } from '@prisma/client';
import { AccessContext, lockIdentity, Sessions } from '../identity/session.service';
import { audit } from '../platform/audit';
import { Commands } from '../platform/commands';
import { CONFIG, Config } from '../platform/config';
import { Database, databaseTime, Transaction } from '../platform/database';
import { failure } from '../platform/http';
import { AttendanceDetailDto, AttendanceQuery, SubmitAttendanceDto } from './attendance.dto';

const read = 'attendance.read';
const submit = 'attendance.submit';

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
  select: { revision: true, outcome: true, submittedAt: true },
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
        items: rows.slice(0, limit).map(row => {
          const revision = row.attendanceParticipants[0]?.revisions[0];
          return {
            bookingId: row.id, clientDisplayName: row.client.displayName,
            bookingStatus: row.status === BookingStatus.CONFIRMED ? BookingStatus.CONFIRMED : BookingStatus.CANCELLED,
            revision: revision?.revision ?? 0, outcome: revision?.outcome ?? null,
            reviewStatus: revision ? 'PENDING_REVIEW' : 'UNSUBMITTED', submittedAt: revision?.submittedAt ?? null,
          };
        }),
        nextCursor: rows.length > limit ? rows[limit - 1].id : null,
      };
    });
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
