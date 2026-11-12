import { Body, Controller, Headers, Post, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiHeader,
  ApiNotFoundResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { RequireAction, StudioRequest } from '../platform/http';
import { RecordedPaymentDto, RecordPaymentDto } from './payment.dto';
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
}
