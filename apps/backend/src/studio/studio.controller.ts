import { Body, Controller, Get, Headers, HttpCode, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';
import { AuditAction, AuditTarget } from '@prisma/client';
import { audit } from '../platform/audit';
import { Commands } from '../platform/commands';
import { Database, databaseTime } from '../platform/database';
import { CurrentAccess, failure, RequireAction, StudioRequest } from '../platform/http';
import { AccessContext, Sessions } from '../identity/session.service';

class StudioSettingsDto {
  @ApiProperty({ example: 'Africa/Cairo' })
  @IsString() @MaxLength(100) @Matches(/^[A-Za-z][A-Za-z0-9_+/-]*$/) timezone!: string;

  @ApiProperty({ example: 'EGP' })
  @IsString() @Matches(/^[A-Z]{3}$/) defaultCurrency!: string;
}

const policyFields = { id: true, version: true, effectiveAt: true, timezone: true, defaultCurrency: true };
const currencies = new Set(Intl.supportedValuesOf('currency'));

@ApiTags('Studio settings')
@ApiBearerAuth()
@Controller('studio-settings')
export class StudioController {
  constructor(private readonly db: Database, private readonly sessions: Sessions, private readonly commands: Commands) {}

  @Get() @RequireAction('studio.configure')
  async get() {
    const settings = await this.db.studioSettings.findUniqueOrThrow({
      where: { singletonKey: 'studio' }, select: { activePolicy: { select: policyFields } },
    });
    return settings;
  }

  @Put() @RequireAction('studio.configure') @HttpCode(200)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async publish(@Body() dto: StudioSettingsDto, @Headers('idempotency-key') key: string | undefined,
    @CurrentAccess() access: AccessContext, @Req() req: StudioRequest) {
    let timezone: string;
    try {
      timezone = new Intl.DateTimeFormat('en', { timeZone: dto.timezone }).resolvedOptions().timeZone;
    } catch {
      throw failure(400, 'INVALID_TIMEZONE');
    }
    if (!currencies.has(dto.defaultCurrency)) throw failure(400, 'INVALID_CURRENCY');
    const outcome = await this.commands.run({
      access, action: 'studio.configure', key, args: [timezone, dto.defaultCurrency],
      write: async tx => {
        const [settings] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM studio_settings WHERE singleton_key = 'studio' FOR UPDATE`;
        const last = await tx.policyRevision.findFirst({ where: { studioId: settings.id }, orderBy: { version: 'desc' } });
        const revision = await tx.policyRevision.create({ data: {
          studioId: settings.id, version: (last?.version ?? 0) + 1, approvedById: access.userId,
          timezone, defaultCurrency: dto.defaultCurrency, effectiveAt: await databaseTime(tx), rules: {},
        } });
        await tx.studioSettings.update({ where: { id: settings.id }, data: { activePolicyId: revision.id } });
        await audit(tx, { actorId: access.userId, action: AuditAction.STUDIO_POLICY_PUBLISHED,
          targetType: AuditTarget.POLICY_REVISION, targetId: revision.id, requestId: req.requestId });
        return { status: 200, reference: revision.id };
      },
    });
    await this.sessions.authorize(this.db, access, ['studio.configure']);
    return this.db.policyRevision.findFirstOrThrow({
      where: { id: outcome.reference!, studio: { singletonKey: 'studio' } }, select: policyFields,
    });
  }
}
