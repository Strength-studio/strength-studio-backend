import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod, PaymentStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { Equals, IsEnum, IsISO8601, IsString, IsUUID, Matches, MaxLength, ValidateIf } from 'class-validator';

const receivedInstant = /^(?!0000)\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const sarAmount = /^(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,2})?$/;

function trimmed(value: unknown) {
  return typeof value === 'string' ? value.trim() : value;
}

export class RecordPaymentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  clientId!: string;

  @ApiProperty({ format: 'uuid', description: 'Stable, caller-generated receipt intake ID. Reuse it when retrying the same reported payment.' })
  @IsUUID()
  intakeId!: string;

  @ApiProperty({ example: '120.50', description: 'Positive decimal string with at most two fractional digits.' })
  @IsString()
  @Matches(sarAmount)
  amount!: string;

  @ApiProperty({ enum: ['SAR'] })
  @Equals('SAR')
  currency!: 'SAR';

  @ApiProperty({ enum: PaymentMethod })
  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @ApiProperty({ format: 'date-time', description: 'Receipt timestamp with an explicit UTC offset and at most millisecond precision.' })
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(receivedInstant)
  receivedAt!: string;

  @ApiPropertyOptional({ minLength: 1, maxLength: 200 })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(({ value }) => trimmed(value))
  @IsString() @MaxLength(200) @Matches(/^[^\u0000-\u001f\u007f]+$/u)
  reference?: string;

  @ApiPropertyOptional({ minLength: 1, maxLength: 2000, description: 'Supporting note or reference to evidence held outside the app.' })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(({ value }) => trimmed(value))
  @IsString() @MaxLength(2000) @Matches(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+$/u)
  evidence?: string;
}

export class RecordedPaymentDto {
  @ApiProperty({ format: 'uuid' })
  paymentId!: string;

  @ApiProperty({ enum: [PaymentStatus.UNVERIFIED] })
  status!: typeof PaymentStatus.UNVERIFIED;
}

export class VerifiedPaymentDto {
  @ApiProperty({ format: 'uuid' })
  paymentId!: string;

  @ApiProperty({ enum: [PaymentStatus.VERIFIED] })
  status!: typeof PaymentStatus.VERIFIED;
}

export class AllocatePaymentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  purchaseId!: string;

  @ApiProperty({ example: '150.00', description: 'Positive decimal string with at most two fractional digits.' })
  @IsString()
  @Matches(sarAmount)
  amount!: string;
}

export class PaymentAllocationDto {
  @ApiProperty({ format: 'uuid' })
  allocationId!: string;

  @ApiProperty({ format: 'uuid' })
  paymentId!: string;

  @ApiProperty({ format: 'uuid' })
  purchaseId!: string;

  @ApiProperty({ example: '150.00' })
  amount!: string;

  @ApiProperty({ enum: ['SAR'] })
  currency!: 'SAR';
}
