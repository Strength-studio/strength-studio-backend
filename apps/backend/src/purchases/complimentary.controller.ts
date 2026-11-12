import { Body, Controller, Headers, Post, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiHeader,
  ApiNotFoundResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { RequireAction, StudioRequest } from '../platform/http';
import { AcceptComplimentaryPackageDto, ComplimentaryAcceptanceDto } from './purchase-acceptance.dto';
import { PurchaseAcceptanceService } from './purchase-acceptance.service';

@ApiTags('Complimentary purchases')
@ApiBearerAuth()
@Controller('purchases')
export class ComplimentaryController {
  constructor(private readonly purchases: PurchaseAcceptanceService) {}

  @Post('complimentary') @RequireAction('purchase.accept_record')
  @ApiOperation({ summary: 'Accept a published SAR 0 version for an existing Client',
    description: 'Admin only. Records agreement evidence and issues one membership pending activation.' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: ComplimentaryAcceptanceDto })
  @ApiBadRequestResponse({ description: 'Invalid request or idempotency key' })
  @ApiUnauthorizedResponse()
  @ApiForbiddenResponse()
  @ApiNotFoundResponse({ description: 'Client or exact package version not found' })
  @ApiConflictResponse({ description: 'Version is ineligible, acceptance already exists, or the idempotency key cannot be replayed' })
  accept(@Body() dto: AcceptComplimentaryPackageDto, @Headers('idempotency-key') key: string | undefined,
    @Req() req: StudioRequest) {
    return this.purchases.acceptComplimentary(req.access!, req.requestId, key, dto);
  }
}
