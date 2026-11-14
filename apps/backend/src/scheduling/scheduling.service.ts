import { Injectable } from '@nestjs/common';
import { AccountState, AuditAction, AuditTarget, Prisma, Role, ScheduledSession, SessionTypeMode } from '@prisma/client';
import { AccessContext, Sessions } from '../identity/session.service';
import { audit } from '../platform/audit';
import { Commands } from '../platform/commands';
import { Database, databaseTime, Transaction } from '../platform/database';
import { failure } from '../platform/http';
import { CancelScheduledSessionDto, CreateScheduledSessionDto, EditScheduledSessionDto, ScheduleWindowDto,
  ScheduledSessionDto, SchedulingSettingsDto } from './scheduling.dto';

type WriteContext = { access: AccessContext; requestId: string; key?: string };
const manage = 'schedule.manage';
const eligibleCoach = { role: Role.COACH, accountState: AccountState.ACTIVE, emailVerifiedAt: { not: null } };

@Injectable()
export class SchedulingService {
  constructor(private readonly db: Database, private readonly commands: Commands, private readonly sessions: Sessions) {}

  settings() {
    return this.db.schedulingSettings.findMany({
      where: { sessionType: { archivedAt: null } },
      orderBy: { sessionTypeId: 'asc' },
      select: { sessionTypeId: true, durationMinutes: true, bufferMinutes: true, groupCapacity: true },
    });
  }

  async coaches() {
    const rows = await this.db.coachProfile.findMany({
      where: { user: eligibleCoach }, orderBy: [{ displayName: 'asc' }, { userId: 'asc' }],
      select: { userId: true, displayName: true },
    });
    return rows.map(({ userId, displayName }) => ({ id: userId, displayName }));
  }

  async list(query: ScheduleWindowDto, coachId?: string) {
    const from = new Date(query.from);
    const until = new Date(query.until);
    if (from >= until) throw failure(400, 'INVALID_SCHEDULE_WINDOW');
    const where = { coachId, startsAt: { gte: from, lt: until } };
    const after = query.after && await this.db.scheduledSession.findFirst({
      where: { ...where, id: query.after }, select: { id: true, startsAt: true },
    });
    if (query.after && !after) throw failure(400, 'INVALID_SCHEDULE_CURSOR');
    const limit = query.limit ?? 50;
    const rows = await this.db.scheduledSession.findMany({
      where: { ...where, ...(after ? { OR: [
        { startsAt: { gt: after.startsAt } }, { startsAt: after.startsAt, id: { gt: after.id } },
      ] } : {}) },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], take: limit + 1,
      select: {
        id: true, sessionTypeId: true, sessionType: { select: { name: true } }, coach: { select: { userId: true, displayName: true } },
        startsAt: true, endsAt: true, bufferMinutes: true, capacity: true, revision: true, cancelledAt: true,
      },
    });
    const items = rows.slice(0, limit).map(({ sessionType, coach, ...row }): ScheduledSessionDto => ({
      ...row, sessionTypeName: sessionType.name, coach: { id: coach.userId, displayName: coach.displayName },
      status: row.cancelledAt ? 'CANCELLED' : 'SCHEDULED',
    }));
    return { items, nextCursor: rows.length > limit ? items[limit - 1].id : null };
  }

  async setSettings(ctx: WriteContext, id: string, dto: SchedulingSettingsDto) {
    const sessionTypeId = id.toLowerCase();
    const data = { durationMinutes: dto.durationMinutes, bufferMinutes: dto.bufferMinutes, groupCapacity: dto.groupCapacity ?? null };
    await this.commands.run({
      ...ctx, action: manage, operation: 'schedule.settings', args: [sessionTypeId, data],
      write: async tx => {
        const [type] = await tx.$queryRaw<{ mode: SessionTypeMode; archivedAt: Date | null }[]>`
          SELECT mode, archived_at AS "archivedAt" FROM session_type WHERE id = ${sessionTypeId}::uuid FOR NO KEY UPDATE`;
        await this.sessions.authorize(tx, ctx.access, [manage]);
        if (!type) throw failure(404, 'SESSION_TYPE_NOT_FOUND');
        if (type.archivedAt) throw failure(409, 'SESSION_TYPE_ARCHIVED');
        if ((type.mode === SessionTypeMode.GROUP) !== (data.groupCapacity !== null)) {
          throw failure(400, 'INVALID_GROUP_CAPACITY');
        }
        await tx.schedulingSettings.upsert({ where: { sessionTypeId }, create: { ...data, sessionTypeId }, update: data });
        await audit(tx, { actorId: ctx.access.userId, requestId: ctx.requestId,
          action: AuditAction.SCHEDULING_SETTINGS_CHANGED, targetType: AuditTarget.SESSION_TYPE,
          targetId: sessionTypeId, redactedDetails: data });
        return { status: 204 };
      },
    });
  }

  async create(ctx: WriteContext, dto: CreateScheduledSessionDto) {
    const sessionTypeId = dto.sessionTypeId.toLowerCase();
    const coachId = dto.coachId.toLowerCase();
    const startsAt = new Date(dto.startsAt);
    const result = await this.commands.run({
      ...ctx, action: manage, operation: 'schedule.create', targetUser: coachId,
      args: [sessionTypeId, coachId, startsAt],
      write: async tx => {
        await this.requireCoach(tx, coachId);
        const [type] = await tx.$queryRaw<{ archivedAt: Date | null }[]>`
          SELECT archived_at AS "archivedAt" FROM session_type WHERE id = ${sessionTypeId}::uuid FOR SHARE`;
        const now = await databaseTime(tx);
        await this.sessions.authorize(tx, ctx.access, [manage]);
        if (!type) throw failure(404, 'SESSION_TYPE_NOT_FOUND');
        if (type.archivedAt) throw failure(409, 'SESSION_TYPE_ARCHIVED');
        if (startsAt <= now) throw failure(409, 'SCHEDULE_START_IN_PAST');
        const settings = await tx.schedulingSettings.findUnique({ where: { sessionTypeId } });
        if (!settings) throw failure(409, 'SCHEDULING_SETTINGS_REQUIRED');
        const endsAt = this.endAt(startsAt, settings.durationMinutes * 60_000);
        const capacity = settings.groupCapacity ?? 1;
        const [{ id }] = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO scheduled_session (session_type_id, coach_id, starts_at, ends_at, buffer_minutes, capacity, created_at, updated_at)
          VALUES (${sessionTypeId}::uuid, ${coachId}::uuid, ${startsAt}, ${endsAt}, ${settings.bufferMinutes}, ${capacity}, ${now}, ${now})
          RETURNING id`.catch(conflict);
        await this.event(tx, ctx, AuditAction.SCHEDULED_SESSION_CREATED, id, {
          sessionTypeId, coachId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(),
          bufferMinutes: settings.bufferMinutes, capacity,
        });
        return { status: 201, reference: id };
      },
    });
    return { sessionId: result.reference! };
  }

  async edit(ctx: WriteContext, id: string, dto: EditScheduledSessionDto) {
    const sessionId = id.toLowerCase();
    const coachId = dto.coachId.toLowerCase();
    const startsAt = new Date(dto.startsAt);
    await this.commands.run({
      ...ctx, action: manage, operation: 'schedule.edit', targetUser: coachId,
      args: [sessionId, dto.expectedRevision, coachId, startsAt],
      write: async tx => {
        await this.requireCoach(tx, coachId);
        const { row, now } = await this.editable(tx, ctx, sessionId, dto.expectedRevision);
        if (startsAt <= now) throw failure(409, 'SCHEDULE_START_IN_PAST');
        const endsAt = this.endAt(startsAt, row.endsAt.valueOf() - row.startsAt.valueOf());
        await tx.$executeRaw`
          UPDATE scheduled_session SET coach_id = ${coachId}::uuid, starts_at = ${startsAt}, ends_at = ${endsAt},
            updated_at = ${now}, revision = revision + 1 WHERE id = ${sessionId}::uuid`.catch(conflict);
        await this.event(tx, ctx, AuditAction.SCHEDULED_SESSION_EDITED, sessionId, {
          previousCoachId: row.coachId, coachId, previousStartsAt: row.startsAt.toISOString(),
          startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(),
        });
        return { status: 204 };
      },
    });
  }

  async cancel(ctx: WriteContext, id: string, dto: CancelScheduledSessionDto) {
    const sessionId = id.toLowerCase();
    await this.commands.run({
      ...ctx, action: manage, operation: 'schedule.cancel', args: [sessionId, dto.expectedRevision, dto.reason],
      write: async tx => {
        const { row, now } = await this.editable(tx, ctx, sessionId, dto.expectedRevision);
        await tx.scheduledSession.update({ where: { id: sessionId }, data: {
          cancelledAt: now, cancellationReason: dto.reason, updatedAt: now, revision: { increment: 1 },
        } });
        await this.event(tx, ctx, AuditAction.SCHEDULED_SESSION_CANCELLED, sessionId, { coachId: row.coachId }, dto.reason);
        return { status: 204 };
      },
    });
  }

  private async requireCoach(tx: Transaction, coachId: string) {
    if (!await tx.coachProfile.findFirst({ where: { userId: coachId, user: eligibleCoach }, select: { userId: true } })) {
      throw failure(409, 'COACH_NOT_ELIGIBLE');
    }
  }

  private async editable(tx: Transaction, ctx: WriteContext, id: string, revision: number) {
    const [row] = await tx.$queryRaw<Pick<ScheduledSession, 'coachId' | 'startsAt' | 'endsAt' | 'cancelledAt' | 'revision'>[]>`
      SELECT coach_id AS "coachId", starts_at AS "startsAt", ends_at AS "endsAt", cancelled_at AS "cancelledAt", revision
      FROM scheduled_session WHERE id = ${id}::uuid FOR UPDATE`;
    const now = await databaseTime(tx);
    await this.sessions.authorize(tx, ctx.access, [manage]);
    if (!row) throw failure(404, 'SCHEDULED_SESSION_NOT_FOUND');
    if (row.cancelledAt || row.startsAt <= now) throw failure(409, 'SCHEDULED_SESSION_NOT_EDITABLE');
    if (row.revision !== revision) throw failure(409, 'SCHEDULED_SESSION_CHANGED');
    return { row, now };
  }

  private endAt(start: Date, durationMs: number) {
    const end = new Date(start.valueOf() + durationMs);
    if (!Number.isFinite(end.valueOf()) || end.getUTCFullYear() > 9999) throw failure(400, 'INVALID_SCHEDULE_END');
    return end;
  }

  private event(tx: Transaction, ctx: WriteContext, action: AuditAction, targetId: string,
    redactedDetails: Prisma.InputJsonObject, reason?: string) {
    return audit(tx, { actorId: ctx.access.userId, requestId: ctx.requestId, action, targetType: AuditTarget.SCHEDULED_SESSION,
      targetId, redactedDetails, reason });
  }
}

function conflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2010' && error.meta?.code === '23P01') {
    throw failure(409, 'COACH_SCHEDULE_CONFLICT');
  }
  throw error;
}
