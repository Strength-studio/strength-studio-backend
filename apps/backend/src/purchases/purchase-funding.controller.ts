import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiConflictResponse, ApiForbiddenResponse, ApiInternalServerErrorResponse,
  ApiHeader, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiServiceUnavailableResponse, ApiTags,
  ApiUnauthorizedResponse } from '@nestjs/swagger';
import { failure, RequireAction, StudioRequest } from '../platform/http';
import { ActivateMembershipDto, MembershipActivationDto, MembershipActivationStateDto } from './membership-activation.dto';
import { MembershipActivationService } from './membership-activation.service';
import { PurchaseFundingDto } from './purchase-funding.dto';
import { PurchaseFundingService } from './purchase-funding.service';

@ApiTags('Purchase funding')
@ApiBearerAuth()
@Controller('purchases')
export class PurchaseFundingController {
  constructor(private readonly funding: PurchaseFundingService, private readonly activation: MembershipActivationService) {}

  @Get(':purchaseId/funding') @RequireAction('purchase.funding.read')
  @ApiOperation({ summary: 'Read purchase funding', description: 'Admin only. Uses frozen terms and recorded allocations.' })
  @ApiParam({ name: 'purchaseId', schema: { type: 'string', format: 'uuid' } })
  @ApiOkResponse({ type: PurchaseFundingDto })
  @ApiBadRequestResponse({ description: 'Invalid purchase ID' })
  @ApiUnauthorizedResponse()
  @ApiForbiddenResponse()
  @ApiNotFoundResponse({ description: 'Purchase not found' })
  @ApiConflictResponse({ description: 'Allocations exceed the frozen purchase price' })
  @ApiInternalServerErrorResponse({ description: 'Invalid stored purchase terms or other internal error' })
  summary(@Param('purchaseId', ParseUUIDPipe) purchaseId: string) {
    return this.funding.summary(purchaseId);
  }

  @Get(':purchaseId/membership') @RequireAction('purchase.funding.read')
  @ApiOperation({ summary: 'Read membership activation state', description: 'Admin only. Reads the membership linked to this purchase.' })
  @ApiParam({ name: 'purchaseId', schema: { type: 'string', format: 'uuid' } })
  @ApiOkResponse({ type: MembershipActivationStateDto })
  @ApiBadRequestResponse({ description: 'Invalid purchase ID' })
  @ApiUnauthorizedResponse()
  @ApiForbiddenResponse()
  @ApiNotFoundResponse({ description: 'Purchase not found' })
  membership(@Param('purchaseId', ParseUUIDPipe) purchaseId: string) {
    return this.activation.state(purchaseId);
  }

  @Post(':purchaseId/activate-membership') @RequireAction('membership.activate') @HttpCode(200)
  @ApiOperation({ summary: 'Activate the membership for a purchase', description: 'Admin only. Checks current funding and starts validity on the Riyadh date of approval. Positive-price purchases with a balance due require an explicit override and reason.' })
  @ApiParam({ name: 'purchaseId', schema: { type: 'string', format: 'uuid' } })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: MembershipActivationDto })
  @ApiBadRequestResponse({ description: 'Invalid input or idempotency key, or missing or invalid override reason' })
  @ApiUnauthorizedResponse()
  @ApiForbiddenResponse()
  @ApiNotFoundResponse({ description: 'Purchase not found' })
  @ApiConflictResponse({ description: 'Membership already activated or ineligible, funding conflict, override required, or idempotency key cannot be replayed' })
  @ApiInternalServerErrorResponse({ description: 'Invalid stored funding terms or other internal error' })
  @ApiServiceUnavailableResponse({ description: 'Retry the transaction with the same idempotency key' })
  activate(@Param('purchaseId', ParseUUIDPipe) purchaseId: string, @Body() dto: ActivateMembershipDto,
    @Headers('idempotency-key') key: string | undefined, @Req() req: StudioRequest) {
    if (!dto || Array.isArray(dto) || !req.is('application/json')) throw failure(400, 'INVALID_INPUT');
    return this.activation.activate(req.access!, req.requestId, key, purchaseId, dto);
  }
}
