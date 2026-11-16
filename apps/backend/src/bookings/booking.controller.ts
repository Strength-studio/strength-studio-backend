import { applyDecorators, Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiHeader,
  ApiNoContentResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Action } from '../identity/permissions';
import { failure, RequireAction, StudioRequest } from '../platform/http';
import { BookingCreatedDto, BookingListQuery, BookingMembershipDto, BookingPageDto, BookingReasonDto,
  BookingSessionQuery, CreateBookingDto } from './booking.dto';
import { BookingService } from './booking.service';

class EmptyBody {}

function BookingWrite(action: Action) {
  return applyDecorators(RequireAction(action), ApiHeader({ name: 'Idempotency-Key', required: true }),
    ApiBadRequestResponse({ description: 'Invalid booking input or idempotency key' }),
    ApiConflictResponse({ description: 'Booking state, capacity, membership eligibility, session cancellation, or idempotency conflict' }));
}

function BookingDecision(action: Action) {
  return applyDecorators(BookingWrite(action), HttpCode(204), ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } }),
    ApiNoContentResponse());
}

const context = (req: StudioRequest, key?: string) => ({ access: req.access!, requestId: req.requestId, key });

@ApiTags('Booking management')
@ApiBearerAuth()
@ApiUnauthorizedResponse()
@ApiForbiddenResponse()
@ApiNotFoundResponse()
@Controller()
export class BookingController {
  constructor(private readonly bookings: BookingService) {}

  @Get('bookings') @RequireAction('booking.read')
  @ApiOperation({ summary: 'List booking history and current capacity for a scheduled session (Admin only)' })
  @ApiOkResponse({ type: BookingPageDto })
  @ApiBadRequestResponse({ description: 'Invalid session, limit, or cursor' })
  list(@Query() query: BookingListQuery) {
    return this.bookings.list(query);
  }

  @Get('clients/:clientId/booking-memberships') @RequireAction('booking.read')
  @ApiOperation({ summary: 'List a Client’s membership choices and eligibility for the selected session (Admin only)' })
  @ApiParam({ name: 'clientId', schema: { type: 'string', format: 'uuid' } })
  @ApiOkResponse({ type: [BookingMembershipDto] })
  @ApiBadRequestResponse({ description: 'Invalid Client or session ID' })
  choices(@Param('clientId', ParseUUIDPipe) id: string, @Query() query: BookingSessionQuery) {
    return this.bookings.choices(id.toLowerCase(), query.scheduledSessionId.toLowerCase());
  }

  @Post('bookings') @BookingWrite('booking.assist')
  @ApiOperation({ summary: 'Create a pending booking for an explicitly selected membership (Admin only)' })
  @ApiCreatedResponse({ type: BookingCreatedDto })
  create(@Body() dto: CreateBookingDto, @Headers('idempotency-key') key: string | undefined, @Req() req: StudioRequest) {
    return this.bookings.create(context(req, key), dto);
  }

  @Post('bookings/:id/approve') @BookingDecision('booking.approve')
  @ApiBody({ required: false, schema: { type: 'object', additionalProperties: false } })
  @ApiOperation({ summary: 'Revalidate and confirm a pending booking (Admin only)' })
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() _body: EmptyBody,
    @Headers('idempotency-key') key: string | undefined, @Req() req: StudioRequest) {
    const hasBody = Number(req.headers['content-length']) > 0 || req.headers['transfer-encoding'];
    if (hasBody && !req.is('application/json')) throw failure(400, 'INVALID_INPUT');
    return this.bookings.decide(context(req, key), id, 'approve');
  }

  @Post('bookings/:id/reject') @BookingDecision('booking.approve')
  @ApiOperation({ summary: 'Reject a pending booking with a reason (Admin only)' })
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: BookingReasonDto,
    @Headers('idempotency-key') key: string | undefined, @Req() req: StudioRequest) {
    return this.bookings.decide(context(req, key), id, 'reject', dto.reason);
  }

  @Post('bookings/:id/cancel') @BookingDecision('booking.cancel.decide')
  @ApiOperation({ summary: 'Cancel a pending or confirmed booking with a reason (Admin only)' })
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: BookingReasonDto,
    @Headers('idempotency-key') key: string | undefined, @Req() req: StudioRequest) {
    return this.bookings.decide(context(req, key), id, 'cancel', dto.reason);
  }
}
