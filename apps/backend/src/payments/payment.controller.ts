import { Body, Controller, Headers, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiHeader,
  ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { failure, RequireAction, StudioRequest } from '../platform/http';
import { RecordedPaymentDto, RecordPaymentDto, VerifiedPaymentDto } from './payment.dto';
import { PaymentService } from './payment.service';

@ApiTags('Payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentController {
  constructor(private readonly payments: PaymentService) {}

  @Post() @RequireAction('payment.record')
  @ApiOperation({ summary: 'Record a reported SAR payment',
    description: 'Requires payment.record. Creates an unverified and unallocated receipt record.' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: RecordedPaymentDto })
  @ApiBadRequestResponse({ description: 'Invalid request or idempotency key' })
  @ApiUnauthorizedResponse()
  @ApiForbiddenResponse()
  @ApiNotFoundResponse({ description: 'Client not found' })
  @ApiConflictResponse({ description: 'Intake already recorded or idempotency key cannot be replayed' })
  record(@Body() dto: RecordPaymentDto, @Headers('idempotency-key') key: string | undefined, @Req() req: StudioRequest) {
    return this.payments.record(req.access!, req.requestId, key, dto);
  }

  @Post(':paymentId/verify') @RequireAction('payment.verify') @HttpCode(200)
  @ApiOperation({ summary: 'Verify a recorded payment',
    description: 'Admin only. Verifies an unverified receipt and records the authenticated verifier and server timestamp.' })
  @ApiParam({ name: 'paymentId', schema: { type: 'string', format: 'uuid' } })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ required: false, schema: { type: 'object', additionalProperties: false } })
  @ApiOkResponse({ type: VerifiedPaymentDto })
  @ApiBadRequestResponse({ description: 'Invalid payment ID, body, or idempotency key' })
  @ApiUnauthorizedResponse()
  @ApiForbiddenResponse()
  @ApiNotFoundResponse({ description: 'Payment not found' })
  @ApiConflictResponse({ description: 'Payment is not unverified or idempotency key cannot be replayed' })
  verify(@Param('paymentId', ParseUUIDPipe) paymentId: string, @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined, @Req() req: StudioRequest) {
    if (body !== undefined && (body === null || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length)) {
      throw failure(400, 'INVALID_INPUT');
    }
    return this.payments.verify(req.access!, req.requestId, key, paymentId);
  }
}
