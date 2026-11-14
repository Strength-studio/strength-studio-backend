import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { fundingStatuses, PurchaseFundingDto } from './purchase-funding.dto';

export class ActivateMembershipDto {
  @ApiPropertyOptional({ description: 'Explicit approval to activate a positive-price purchase with a balance due.' })
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  override?: boolean;

  @ApiPropertyOptional({ maxLength: 500, description: 'Reason for proceeding with a balance due. Required when override is true.' })
  @ValidateIf((_, value) => value !== undefined)
  @IsString() @MaxLength(500) @Matches(/^[^\u0000]*$/u)
  overrideReason?: string;
}

export class MembershipActivationStateDto {
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  membershipId!: string | null;

  @ApiProperty({ enum: ['NOT_CREATED', 'PENDING_ACTIVATION', 'ACTIVE', 'EXPIRED', 'INELIGIBLE'] })
  status!: 'NOT_CREATED' | 'PENDING_ACTIVATION' | 'ACTIVE' | 'EXPIRED' | 'INELIGIBLE';
}

export class ActivatedMembershipDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) purchaseId!: string;
  @ApiProperty({ enum: ['ACTIVE'] }) status!: 'ACTIVE';
  @ApiProperty({ type: String, format: 'date-time' }) activatedAt!: string;
  @ApiProperty({ format: 'date', description: 'First validity date in Asia/Riyadh.' }) validFrom!: string;
  @ApiProperty({ format: 'date', description: 'Last validity date in Asia/Riyadh, inclusive.' }) validThrough!: string;
  @ApiProperty({ type: Number, nullable: true, minimum: 1 }) initialSessionAllowance!: number | null;
}

export class MembershipActivationDto {
  @ApiProperty({ type: ActivatedMembershipDto }) membership!: ActivatedMembershipDto;
  @ApiProperty({ enum: ['COMPLIMENTARY', 'POSITIVE_PRICE'] }) purchaseType!: 'COMPLIMENTARY' | 'POSITIVE_PRICE';
  @ApiProperty({ enum: fundingStatuses }) fundingStatus!: PurchaseFundingDto['fundingStatus'];
  @ApiProperty() overrideUsed!: boolean;
  @ApiPropertyOptional({ maxLength: 500 }) overrideReason?: string;
}
