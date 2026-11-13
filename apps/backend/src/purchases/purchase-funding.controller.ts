import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiConflictResponse, ApiForbiddenResponse, ApiInternalServerErrorResponse,
  ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { RequireAction } from '../platform/http';
import { PurchaseFundingDto } from './purchase-funding.dto';
import { PurchaseFundingService } from './purchase-funding.service';

@ApiTags('Purchase funding')
@ApiBearerAuth()
@Controller('purchases')
export class PurchaseFundingController {
  constructor(private readonly funding: PurchaseFundingService) {}

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
}
