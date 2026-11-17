import { AttendanceOutcome, BookingStatus } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsObject, IsUUID, Max, Min, ValidateIf, ValidateNested } from 'class-validator';
import { EligibleCoachDto } from '../scheduling/scheduling.dto';

const maxInt = 2_147_483_647;

export class AttendanceQuery {
  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 100, default: 50 })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(({ value }) => typeof value === 'string' && /^(?:[1-9][0-9]?|100)$/.test(value) ? Number(value) : value)
  @IsInt() @Min(1) @Max(100)
  limit?: number;

  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_, value) => value !== undefined)
  @IsUUID()
  after?: string;
}

class SubmissionEntryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  bookingId!: string;

  @ApiProperty({ type: 'integer', minimum: 0, maximum: maxInt, description: 'Use zero for the first submission.' })
  @IsInt() @Min(0) @Max(maxInt)
  expectedRevision!: number;

  @ApiProperty({ enum: AttendanceOutcome })
  @IsIn([AttendanceOutcome.ATTENDED])
  outcome!: AttendanceOutcome;
}

export class SubmitAttendanceDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: maxInt })
  @IsInt() @Min(1) @Max(maxInt)
  expectedScheduleRevision!: number;

  @ApiProperty({ type: [SubmissionEntryDto], minItems: 1, maxItems: 50 })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @IsObject({ each: true })
  @ValidateNested({ each: true }) @Type(() => SubmissionEntryDto)
  entries!: SubmissionEntryDto[];
}

class ServedAttributionDto {
  @ApiProperty({ format: 'uuid' }) coachId!: string;
  @ApiProperty() coachDisplayName!: string;
  @ApiProperty({ type: String, format: 'date-time' }) startsAt!: Date;
  @ApiProperty({ format: 'uuid' }) sessionTypeId!: string;
  @ApiProperty() sessionTypeName!: string;
}

class AttendanceSessionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) sessionTypeId!: string;
  @ApiProperty() sessionTypeName!: string;
  @ApiProperty({ type: EligibleCoachDto }) coach!: EligibleCoachDto;
  @ApiProperty({ type: String, format: 'date-time' }) startsAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) endsAt!: Date;
  @ApiProperty() revision!: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) cancelledAt!: Date | null;
  @ApiProperty({ type: ServedAttributionDto, nullable: true }) served!: ServedAttributionDto | null;
}

class AttendanceItemDto {
  @ApiProperty({ format: 'uuid' }) bookingId!: string;
  @ApiProperty() clientDisplayName!: string;
  @ApiProperty({ enum: [BookingStatus.CONFIRMED, BookingStatus.CANCELLED] })
  bookingStatus!: typeof BookingStatus.CONFIRMED | typeof BookingStatus.CANCELLED;
  @ApiProperty() revision!: number;
  @ApiProperty({ enum: AttendanceOutcome, nullable: true }) outcome!: AttendanceOutcome | null;
  @ApiProperty({ enum: ['UNSUBMITTED', 'PENDING_REVIEW'] }) reviewStatus!: 'UNSUBMITTED' | 'PENDING_REVIEW';
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) submittedAt!: Date | null;
}

export class AttendanceDetailDto {
  @ApiProperty({ type: AttendanceSessionDto }) session!: AttendanceSessionDto;
  @ApiProperty({ type: String, format: 'date-time' }) serverTime!: Date;
  @ApiProperty() submissionEnabled!: boolean;
  @ApiProperty({ type: [AttendanceItemDto] }) items!: AttendanceItemDto[];
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) nextCursor!: string | null;
}
