import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiConflictResponse, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AccountState, AuditAction, AuditTarget, Role } from '@prisma/client';
import { audit } from '../platform/audit';
import { Commands } from '../platform/commands';
import { Database, databaseTime } from '../platform/database';
import { CurrentAccess, failure, Public, RequireAction, StudioRequest } from '../platform/http';
import { AccessEvents } from './access-events';
import { ExceptionDto, GrantDto, InviteClientDto, LoginDto, LogoutDto, RefreshDto, TokenPairDto } from './identity.dto';
import { staffPermissions } from './permissions';
import { AccessContext, Sessions } from './session.service';

@ApiTags('Identity')
@Controller('auth')
export class AuthController {
  constructor(private readonly sessions: Sessions) {}

  @Post('login') @Public() @HttpCode(200)
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @ApiOkResponse({ type: TokenPairDto })
  login(@Body() dto: LoginDto) {
    return this.sessions.login(dto.email, dto.password);
  }

  @Post('refresh') @Public() @HttpCode(200)
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  @ApiOkResponse({ type: TokenPairDto })
  refresh(@Body() dto: RefreshDto, @Req() req: StudioRequest) {
    return this.sessions.refresh(dto.refreshToken, req.requestId);
  }

  // Either credential may revoke its own session. No refresh rotation is needed just to log out.
  @Post('logout') @Public() @HttpCode(204)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  logout(@Body() dto: LogoutDto, @Req() req: StudioRequest) {
    if (req.headers.authorization) {
      return this.sessions.logout(this.sessions.parseAccess(req.headers.authorization), req.requestId);
    }
    if (dto?.refreshToken) return this.sessions.logoutWithRefresh(dto.refreshToken, req.requestId);
    throw failure(401, 'UNAUTHENTICATED');
  }

  @Post('socket-ticket') @RequireAction('account.self') @HttpCode(200) @ApiBearerAuth()
  ticket(@CurrentAccess() access: AccessContext) {
    return this.sessions.socketTicket(access);
  }

  @Post('register') @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiConflictResponse({ description: 'Onboarding and recovery policy pending (O-02)' })
  register() {
    throw failure(409, 'ONBOARDING_POLICY_PENDING');
  }

  @Post('verify-email') @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiConflictResponse({ description: 'Onboarding policy pending (O-02)' })
  verifyEmail() {
    throw failure(409, 'ONBOARDING_POLICY_PENDING');
  }

  @Post('reset-password') @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiConflictResponse({ description: 'Recovery policy pending (O-02)' })
  resetPassword() {
    throw failure(409, 'ONBOARDING_POLICY_PENDING');
  }
}

@ApiTags('Accounts')
@ApiBearerAuth()
@Controller()
export class AccountsController {
  constructor(private readonly db: Database, private readonly sessions: Sessions, private readonly commands: Commands,
    private readonly events: AccessEvents) {}

  @Get('me') @RequireAction('account.self')
  async me(@CurrentAccess() access: AccessContext) {
    const { user } = await this.sessions.authorize(this.db, access, ['account.self']);
    return { id: user.id, email: user.normalizedEmail, role: user.role };
  }

  @Get('users/:id') @RequireAction('user.manage', 'client.manage')
  async user(@Param('id', ParseUUIDPipe) id: string, @CurrentAccess() access: AccessContext) {
    const { user } = await this.sessions.authorize(this.db, access, ['user.manage', 'client.manage']);
    const target = await this.db.user.findFirst({
      where: { id, ...(user.role === Role.ADMIN ? {} : { role: Role.CLIENT }) },
      select: { id: true, normalizedEmail: true, role: true, accountState: true },
    });
    if (!target) throw failure(404, 'USER_NOT_FOUND');
    return { id: target.id, email: target.normalizedEmail, role: target.role, accountState: target.accountState };
  }

  @Post('users/invite') @RequireAction('client.manage')
  @ApiConflictResponse({ description: 'Client-only invitation is gated by O-02' })
  invite(@Body() _dto: InviteClientDto) {
    throw failure(409, 'ONBOARDING_POLICY_PENDING');
  }

  @Post('users/:id/disable') @RequireAction('user.manage') @HttpCode(204)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async disable(@Param('id', ParseUUIDPipe) id: string, @Headers('idempotency-key') key: string | undefined,
    @CurrentAccess() access: AccessContext, @Req() req: StudioRequest) {
    const targetId = id.toLowerCase();
    const outcome = await this.commands.run({
      access, action: 'user.manage', key, args: ['disable', targetId], targetUser: targetId, revokeTargetSessions: true,
      scope: async tx => {
        const target = await tx.user.findUnique({ where: { id: targetId }, select: { role: true } });
        if (!target) throw failure(404, 'USER_NOT_FOUND');
        if (target.role === Role.ADMIN) throw failure(409, 'ADMIN_LIFECYCLE_POLICY_PENDING');
      },
      write: async tx => {
        const updated = await tx.user.updateMany({ where: { id: targetId, accountState: { not: AccountState.DISABLED } },
          data: { accountState: AccountState.DISABLED } });
        const now = await databaseTime(tx);
        await tx.authSession.updateMany({ where: { userId: targetId, revokedAt: null }, data: { revokedAt: now } });
        if (updated.count) {
          await audit(tx, { actorId: access.userId, action: AuditAction.ACCOUNT_DISABLED,
            targetType: AuditTarget.USER, targetId, requestId: req.requestId });
        }
        return { status: 204 };
      },
    });
    if (outcome.executed) this.events.revoke(targetId);
  }

  @Put('staff-grants/:id/:permission') @RequireAction('staff.grant.manage') @HttpCode(204)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async grant(@Param('id', ParseUUIDPipe) id: string, @Param('permission') action: string, @Body() dto: GrantDto,
    @Headers('idempotency-key') key: string | undefined, @CurrentAccess() access: AccessContext, @Req() req: StudioRequest) {
    const targetId = id.toLowerCase();
    const permission = staffPermissions.get(action);
    if (!permission) throw failure(400, 'INVALID_STAFF_PERMISSION');
    const outcome = await this.commands.run({
      access, action: 'staff.grant.manage', key, args: [targetId, action, dto.enabled], targetUser: targetId,
      scope: async tx => {
        const target = await tx.user.findFirst({ where: { id: targetId, role: Role.STAFF }, select: { id: true } });
        if (!target) throw failure(404, 'STAFF_NOT_FOUND');
      },
      write: async tx => {
        const where = { staffUserId_permission: { staffUserId: targetId, permission } };
        const previous = await tx.staffGrant.findUnique({ where });
        if (dto.enabled !== (!!previous && previous.revokedAt === null)) {
          const now = await databaseTime(tx);
          const row = await tx.staffGrant.upsert({
            where, create: { staffUserId: targetId, permission, changedById: access.userId },
            update: { revokedAt: dto.enabled ? null : now, changedById: access.userId },
          });
          await audit(tx, { actorId: access.userId, action: AuditAction.STAFF_GRANT_CHANGED, targetType: AuditTarget.STAFF_GRANT,
            targetId: row.id, requestId: req.requestId, redactedDetails: { permission: action, enabled: dto.enabled } });
        }
        return { status: 204 };
      },
    });
    if (outcome.executed) this.events.revoke(targetId);
  }
}

@ApiTags('Deferred workflow boundaries')
@ApiBearerAuth()
@Controller()
export class DeferredController {
  @Post('memberships/:id/activate') @RequireAction('membership.activate')
  @ApiConflictResponse({ description: 'Admin-only activation boundary, no membership mutation' })
  activate(@Param('id', ParseUUIDPipe) _id: string) {
    throw failure(409, 'WORKFLOW_NOT_ENABLED');
  }

  @Post('memberships/:id/activate-exception') @RequireAction('membership.activate_exception')
  @ApiConflictResponse({ description: 'Admin-only exception boundary, no membership mutation' })
  activateException(@Param('id', ParseUUIDPipe) _id: string, @Body() dto: ExceptionDto) {
    if (!dto.reason.trim()) throw failure(400, 'INVALID_INPUT');
    throw failure(409, 'WORKFLOW_NOT_ENABLED');
  }

  @Get('admin/commissions') @RequireAction('commission.read')
  @ApiConflictResponse({ description: 'Admin-only boundary, no commission records in Foundation' })
  commissions() {
    throw failure(409, 'WORKFLOW_NOT_ENABLED');
  }
}
