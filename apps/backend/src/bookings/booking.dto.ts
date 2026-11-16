import { BookingStatus, PackageKind } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { EligibleCoachDto } from '../scheduling/scheduling.dto';

export class BookingSessionQuery {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  scheduledSessionId!: string;
}

export class BookingListQuery extends BookingSessionQuery {
  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 100, default: 50 })
  @ValidateIf((_, value) => value !== undefined)
  @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_, value) => value !== undefined)
  @IsUUID()
  after?: string;
}

export class CreateBookingDto extends BookingSessionQuery {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  clientId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  membershipId!: string;
}

export class BookingReasonDto {
  @ApiProperty({ minLength: 1, maxLength: 500 })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @IsNotEmpty() @Matches(/^[^\u0000]+$/u) @MaxLength(500)
  reason!: string;
}

export class BookingCreatedDto {
  @ApiProperty({ format: 'uuid' }) bookingId!: string;
  @ApiProperty({ enum: [BookingStatus.PENDING] }) status!: typeof BookingStatus.PENDING;
}

export const membershipReasons = [
  'SESSION_CANCELLED', 'MEMBERSHIP_INACTIVE', 'MEMBERSHIP_EXPIRED', 'OUTSIDE_VALIDITY',
  'SESSION_TYPE_NOT_ALLOWED', 'ALLOWANCE_EXHAUSTED',
] as const;

export type MembershipReason = typeof membershipReasons[number];

export class BookingMembershipDto {
  @ApiProperty({ format: 'uuid' }) membershipId!: string;
  @ApiProperty({ type: String, nullable: true }) packageLabel!: string | null;
  @ApiProperty({ enum: PackageKind, nullable: true }) packageKind!: PackageKind | null;
  @ApiProperty({ type: String, format: 'date', nullable: true }) validFrom!: string | null;
  @ApiProperty({ type: String, format: 'date', nullable: true }) validThrough!: string | null;
  @ApiProperty() eligible!: boolean;
  @ApiProperty({ enum: membershipReasons, nullable: true }) reason!: MembershipReason | null;
  @ApiProperty({ type: 'integer', nullable: true }) initialSessionAllowance!: number | null;
  @ApiProperty({ type: 'integer', nullable: true }) confirmedCommitments!: number | null;
  @ApiProperty({ type: 'integer', nullable: true }) remainingCommitments!: number | null;
}

export class BookingSessionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) sessionTypeId!: string;
  @ApiProperty() sessionTypeName!: string;
  @ApiProperty({ type: EligibleCoachDto }) coach!: EligibleCoachDto;
  @ApiProperty({ type: String, format: 'date-time' }) startsAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) endsAt!: Date;
  @ApiProperty({ enum: ['SCHEDULED', 'CANCELLED'] }) status!: 'SCHEDULED' | 'CANCELLED';
  @ApiProperty({ type: 'integer' }) capacity!: number;
  @ApiProperty({ type: 'integer' }) confirmedBookingCount!: number;
}

export class BookingItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) clientId!: string;
  @ApiProperty() clientDisplayName!: string;
  @ApiProperty({ format: 'uuid' }) scheduledSessionId!: string;
  @ApiProperty({ format: 'uuid' }) membershipId!: string;
  @ApiProperty({ type: String, nullable: true }) packageLabel!: string | null;
  @ApiProperty({ enum: BookingStatus }) status!: BookingStatus;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: Date;
  @ApiProperty({ description: 'A confirmed booking whose current scheduled session falls outside its membership coverage.' })
  requiresReview!: boolean;
}

export class BookingPageDto {
  @ApiProperty({ type: BookingSessionDto }) session!: BookingSessionDto;
  @ApiProperty({ type: [BookingItemDto] }) items!: BookingItemDto[];
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) nextCursor!: string | null;
}
