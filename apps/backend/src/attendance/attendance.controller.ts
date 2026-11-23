import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiConflictResponse, ApiForbiddenResponse, ApiHeader,
  ApiNoContentResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags,
  ApiUnauthorizedResponse } from '@nestjs/swagger';
import { failure, RequireAction, StudioRequest } from '../platform/http';
import { AttendanceDetailDto, AttendanceHistoryDto, AttendanceQuery, ReaffirmAttendanceDto, ReturnAttendanceDto, SubmitAttendanceDto } from './attendance.dto';
import { AttendanceService } from './attendance.service';

@ApiTags('Attendance')
@ApiBearerAuth()
@ApiUnauthorizedResponse()
@ApiForbiddenResponse()
@ApiNotFoundResponse()
@Controller('attendance/sessions')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get(':sessionId') @RequireAction('attendance.read')
  @ApiParam({ name: 'sessionId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({ summary: 'Read the confirmed roster and submitted attendance (Admin or assigned Coach)' })
  @ApiOkResponse({ type: AttendanceDetailDto })
  @ApiBadRequestResponse({ description: 'Invalid session ID, query, or roster cursor' })
  detail(@Param('sessionId', ParseUUIDPipe) id: string, @Query() query: AttendanceQuery, @Req() req: StudioRequest) {
    return this.attendance.detail(req.access!, id, query);
  }

  @Get(':sessionId/participants/:bookingId') @RequireAction('attendance.read')
  @ApiParam({ name: 'sessionId', schema: { type: 'string', format: 'uuid' } })
  @ApiParam({ name: 'bookingId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({ summary: 'Read immutable participant submissions and Admin return decisions (Admin or assigned Coach)' })
  @ApiOkResponse({ type: AttendanceHistoryDto })
  @ApiBadRequestResponse({ description: 'Invalid IDs, query, or participant revision cursor' })
  history(@Param('sessionId', ParseUUIDPipe) id: string, @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Query() query: AttendanceQuery, @Req() req: StudioRequest) {
    return this.attendance.history(req.access!, id, bookingId, query);
  }

  @Post(':sessionId/participants/:bookingId/return') @RequireAction('attendance.return') @HttpCode(204)
  @ApiParam({ name: 'sessionId', schema: { type: 'string', format: 'uuid' } })
  @ApiParam({ name: 'bookingId', schema: { type: 'string', format: 'uuid' } })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Return the latest pending participant revision with a mandatory reason (Admin only)' })
  @ApiNoContentResponse() @ApiBadRequestResponse() @ApiConflictResponse()
  async returnForCorrection(@Param('sessionId', ParseUUIDPipe) id: string, @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Body() dto: ReturnAttendanceDto, @Headers('idempotency-key') key: string | undefined, @Req() req: StudioRequest) {
    if (!req.is('application/json') || Object.keys(req.query).length) throw failure(400, 'INVALID_INPUT');
    await this.attendance.returnForCorrection({ access: req.access!, requestId: req.requestId, key }, id, bookingId, dto);
  }

  @Post(':sessionId/participants/:bookingId/reaffirm') @RequireAction('attendance.reaffirm') @HttpCode(204)
  @ApiParam({ name: 'sessionId', schema: { type: 'string', format: 'uuid' } })
  @ApiParam({ name: 'bookingId', schema: { type: 'string', format: 'uuid' } })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Reaffirm ATTENDED after reviewing the latest return reason (assigned Coach only)',
    description: 'Appends an immutable revision; no editable attendance details or alternative outcomes. Production capture remains gated.' })
  @ApiNoContentResponse() @ApiBadRequestResponse() @ApiConflictResponse()
  async reaffirm(@Param('sessionId', ParseUUIDPipe) id: string, @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Body() dto: ReaffirmAttendanceDto, @Headers('idempotency-key') key: string | undefined, @Req() req: StudioRequest) {
    if (!req.is('application/json') || Object.keys(req.query).length) throw failure(400, 'INVALID_INPUT');
    await this.attendance.reaffirm({ access: req.access!, requestId: req.requestId, key }, id, bookingId, dto);
  }

  @Post(':sessionId/submit') @RequireAction('attendance.submit') @HttpCode(204)
  @ApiParam({ name: 'sessionId', schema: { type: 'string', format: 'uuid' } })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({
    summary: 'Submit attendance for explicitly selected confirmed participants (assigned Coach only)',
    description: 'Requires database time at or after scheduled start. Production capture remains gated pending the O-09 deadline.',
  })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ description: 'Invalid JSON, submission fields, duplicate bookings, or idempotency key' })
  @ApiConflictResponse({ description: 'Capture gate, schedule or booking state, stale revision, or idempotency conflict' })
  async submit(@Param('sessionId', ParseUUIDPipe) id: string, @Body() dto: SubmitAttendanceDto,
    @Headers('idempotency-key') key: string | undefined, @Req() req: StudioRequest) {
    if (!req.is('application/json') || Object.keys(req.query).length) throw failure(400, 'INVALID_INPUT');
    await this.attendance.submit({ access: req.access!, requestId: req.requestId, key }, id, dto);
  }
}
