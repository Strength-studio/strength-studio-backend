import { Body, Controller, Headers, Post, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiHeader,
  ApiNotFoundResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { RequireAction, StudioRequest } from '../platform/http';
import { AcceptPositivePricePackageDto, PositivePriceAcceptanceDto } from './purchase-acceptance.dto';
import { PurchaseAcceptanceService } from './purchase-acceptance.service';

@ApiTags('Positive-price purchases')
@ApiBearerAuth()
@Controller('purchases')
export class PositivePriceController {
  constructor(private readonly purchases: PurchaseAcceptanceService) {}

  @Post('positive-price') @RequireAction('purchase.accept_record')
  @ApiOperation({ summary: 'Accept a published positive-price version for an existing Client',
    description: 'Admin only. Records the commercial agreement and its evidence.' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: PositivePriceAcceptanceDto })
  @ApiBadRequestResponse({ description: 'Invalid request or idempotency key' })
  @ApiUnauthorizedResponse()
  @ApiForbiddenResponse()
  @ApiNotFoundResponse({ description: 'Client or exact package version not found' })
  @ApiConflictResponse({ description: 'Version is ineligible, acceptance already exists, or the idempotency key cannot be replayed' })
  accept(@Body() dto: AcceptPositivePricePackageDto, @Headers('idempotency-key') key: string | undefined,
    @Req() req: StudioRequest) {
    return this.purchases.acceptPositivePrice(req.access!, req.requestId, key, dto);
  }
}
