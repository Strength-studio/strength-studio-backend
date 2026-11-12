import { ApiProperty } from '@nestjs/swagger';
import { AgreementMethod, MembershipStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

function trimmed(value: unknown) {
  return typeof value === 'string' ? value.trim() : value;
}

export class AcceptPackageDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  clientId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  packageId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  packageVersionId!: string;

  @ApiProperty({ enum: AgreementMethod })
  @IsEnum(AgreementMethod)
  agreementMethod!: AgreementMethod;

  @ApiProperty({ minLength: 1, maxLength: 2000,
    description: 'Reference to a signed agreement or a supporting note for a verbal agreement, according to agreementMethod.' })
  @Transform(({ value }) => trimmed(value))
  @IsString() @IsNotEmpty() @MaxLength(2000) @Matches(/^[^\u0000]+$/u)
  agreementEvidence!: string;

  @ApiProperty({ minLength: 1, maxLength: 240, description: 'Purpose of accepting the package.' })
  @Transform(({ value }) => trimmed(value))
  @IsString() @IsNotEmpty() @MaxLength(240) @Matches(/^[^\u0000]+$/u)
  purpose!: string;
}

export class AcceptComplimentaryPackageDto extends AcceptPackageDto {
  @ApiProperty({ minLength: 1, maxLength: 240, description: 'Purpose of complimentary issuance.' })
  declare purpose: string;
}

export class AcceptPositivePricePackageDto extends AcceptPackageDto {}

export class PositivePriceAcceptanceDto {
  @ApiProperty({ format: 'uuid' })
  purchaseId!: string;
}

export class ComplimentaryAcceptanceDto {
  @ApiProperty({ format: 'uuid' })
  acceptanceId!: string;

  @ApiProperty({ format: 'uuid' })
  membershipId!: string;

  @ApiProperty({ enum: MembershipStatus })
  status!: MembershipStatus;
}
