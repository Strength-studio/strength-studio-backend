import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiConflictResponse, ApiForbiddenResponse, ApiHeader,
  ApiNoContentResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags,
  ApiUnauthorizedResponse } from '@nestjs/swagger';
import { failure, RequireAction, StudioRequest } from '../platform/http';
import { AttendanceDetailDto, AttendanceQuery, SubmitAttendanceDto } from './attendance.dto';
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
