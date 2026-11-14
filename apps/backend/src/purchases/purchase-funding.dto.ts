import { ApiProperty } from '@nestjs/swagger';

export const fundingStatuses = ['UNFUNDED', 'PARTIALLY_FUNDED', 'FULLY_FUNDED'] as const;

export class PurchaseFundingDto {
  @ApiProperty({ format: 'uuid' })
  purchaseId!: string;

  @ApiProperty({ enum: ['SAR'] })
  currency!: 'SAR';

  @ApiProperty({ example: '500.00', description: 'Frozen purchase price with two fractional digits.' })
  purchasePrice!: string;

  @ApiProperty({ example: '200.00', description: 'Total of existing allocations with two fractional digits.' })
  allocatedAmount!: string;

  @ApiProperty({ example: '300.00', description: 'Amount still due with two fractional digits.' })
  remainingAmount!: string;

  @ApiProperty({ enum: fundingStatuses, description: 'FULLY_FUNDED includes complimentary purchases with zero due.' })
  fundingStatus!: typeof fundingStatuses[number];
}
