import { applyDecorators, Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiHeader,
  ApiNoContentResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { RequireAction, StudioRequest } from '../platform/http';
import { CancelScheduledSessionDto, CreateScheduledSessionDto, EditScheduledSessionDto, EligibleCoachDto, SchedulePageDto,
  ScheduleQueryDto, ScheduleWindowDto, ScheduledSessionCreatedDto, SchedulingSettingsDto, SchedulingSettingsViewDto } from './scheduling.dto';
import { SchedulingService } from './scheduling.service';

function ScheduleWrite() {
  return applyDecorators(RequireAction('schedule.manage'), ApiHeader({ name: 'Idempotency-Key', required: true }),
    ApiBadRequestResponse({ description: 'Invalid scheduling input or idempotency key' }),
    ApiNotFoundResponse({ description: 'Referenced session or session type not found' }),
    ApiConflictResponse({ description: 'Coach schedule conflict, ineligible or changed record, or idempotency conflict' }));
}

const context = (req: StudioRequest, key?: string) => ({ access: req.access!, requestId: req.requestId, key });

@ApiTags('Scheduling')
@ApiBearerAuth()
@ApiUnauthorizedResponse()
@ApiForbiddenResponse()
@Controller('scheduling')
export class SchedulingController {
  constructor(private readonly scheduling: SchedulingService) {}

  @Get('settings') @RequireAction('schedule.read')
  @ApiOperation({ summary: 'List scheduling settings for active session types (Admin only)' })
  @ApiOkResponse({ type: [SchedulingSettingsViewDto] })
  settings() { return this.scheduling.settings(); }

  @Patch('settings/:sessionTypeId') @ScheduleWrite() @HttpCode(204)
  @ApiOperation({ summary: 'Set scheduling defaults for a session type (Admin only)' })
  @ApiParam({ name: 'sessionTypeId', schema: { type: 'string', format: 'uuid' } })
  @ApiNoContentResponse()
  setSettings(@Param('sessionTypeId', ParseUUIDPipe) id: string, @Body() dto: SchedulingSettingsDto,
    @Headers('idempotency-key') key: string | undefined, @Req() req: StudioRequest) {
    return this.scheduling.setSettings(context(req, key), id, dto);
  }

  @Get('coaches') @RequireAction('schedule.read')
  @ApiOperation({ summary: 'List eligible coaches (Admin only)' })
  @ApiOkResponse({ type: [EligibleCoachDto] })
  coaches() { return this.scheduling.coaches(); }

  @Get('sessions') @RequireAction('schedule.read')
  @ApiOperation({ summary: 'List scheduled sessions by time window and optional coach (Admin only)' })
  @ApiOkResponse({ type: SchedulePageDto })
  @ApiBadRequestResponse({ description: 'Invalid date range, coach, limit, or cursor' })
  list(@Query() query: ScheduleQueryDto) { return this.scheduling.list(query, query.coachId); }

  @Get('my-sessions') @RequireAction('schedule.read_own')
  @ApiOperation({ summary: 'List the current Coach’s assigned sessions' })
  @ApiOkResponse({ type: SchedulePageDto })
  @ApiBadRequestResponse({ description: 'Invalid date range, limit, or cursor' })
  own(@Query() query: ScheduleWindowDto, @Req() req: StudioRequest) {
    return this.scheduling.list(query, req.access!.userId);
  }

  @Post('sessions') @ScheduleWrite()
  @ApiOperation({ summary: 'Schedule a session and assign a coach (Admin only)' })
  @ApiCreatedResponse({ type: ScheduledSessionCreatedDto })
  create(@Body() dto: CreateScheduledSessionDto, @Headers('idempotency-key') key: string | undefined, @Req() req: StudioRequest) {
    return this.scheduling.create(context(req, key), dto);
  }

  @Patch('sessions/:sessionId') @ScheduleWrite() @HttpCode(204)
  @ApiOperation({ summary: 'Move or reassign an upcoming session (Admin only)' })
  @ApiParam({ name: 'sessionId', schema: { type: 'string', format: 'uuid' } })
  @ApiNoContentResponse()
  edit(@Param('sessionId', ParseUUIDPipe) id: string, @Body() dto: EditScheduledSessionDto,
    @Headers('idempotency-key') key: string | undefined, @Req() req: StudioRequest) {
    return this.scheduling.edit(context(req, key), id, dto);
  }

  @Post('sessions/:sessionId/cancel') @ScheduleWrite() @HttpCode(204)
  @ApiOperation({ summary: 'Cancel an upcoming session with a reason (Admin only)' })
  @ApiParam({ name: 'sessionId', schema: { type: 'string', format: 'uuid' } })
  @ApiNoContentResponse()
  cancel(@Param('sessionId', ParseUUIDPipe) id: string, @Body() dto: CancelScheduledSessionDto,
    @Headers('idempotency-key') key: string | undefined, @Req() req: StudioRequest) {
    return this.scheduling.cancel(context(req, key), id, dto);
  }
}
