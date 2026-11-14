import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsISO8601, IsNotEmpty, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

const maxInt = 2_147_483_647;
const offsetInstant = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

export class SchedulingSettingsDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  @IsInt() @Min(1) @Max(maxInt)
  durationMinutes!: number;

  @ApiProperty({ type: 'integer', minimum: 0, description: 'Post-session buffer, in minutes.' })
  @IsInt() @Min(0) @Max(maxInt)
  bufferMinutes!: number;

  @ApiPropertyOptional({ type: 'integer', nullable: true, minimum: 1, description: 'Required for group types. Omit or use null for individual types.' })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsInt() @Min(1) @Max(maxInt)
  groupCapacity?: number | null;
}

export class SchedulingSettingsViewDto extends SchedulingSettingsDto {
  @ApiProperty({ format: 'uuid' }) sessionTypeId!: string;
  @ApiProperty({ type: 'integer', nullable: true, minimum: 1, required: true })
  declare groupCapacity: number | null;
}

export class SessionAssignmentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  coachId!: string;

  @ApiProperty({ format: 'date-time', example: '2027-01-05T09:30:00+03:00', description: 'Start instant with an explicit UTC offset.' })
  @IsISO8601({ strict: true, strictSeparator: true }) @Matches(offsetInstant)
  startsAt!: string;
}

export class CreateScheduledSessionDto extends SessionAssignmentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  sessionTypeId!: string;
}

export class EditScheduledSessionDto extends SessionAssignmentDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  @IsInt() @Min(1) @Max(maxInt)
  expectedRevision!: number;
}

export class CancelScheduledSessionDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  @IsInt() @Min(1) @Max(maxInt)
  expectedRevision!: number;

  @ApiProperty({ minLength: 1, maxLength: 500 })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @IsNotEmpty() @Matches(/^[^\u0000]+$/u) @MaxLength(500)
  reason!: string;
}

export class ScheduleWindowDto {
  @ApiProperty({ format: 'date-time', description: 'Inclusive start filter.' })
  @IsISO8601({ strict: true, strictSeparator: true }) @Matches(offsetInstant)
  from!: string;

  @ApiProperty({ format: 'date-time', description: 'Exclusive start filter.' })
  @IsISO8601({ strict: true, strictSeparator: true }) @Matches(offsetInstant)
  until!: string;

  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 100, default: 50 })
  @ValidateIf((_, value) => value !== undefined)
  @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_, value) => value !== undefined)
  @IsUUID()
  after?: string;
}

export class ScheduleQueryDto extends ScheduleWindowDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_, value) => value !== undefined)
  @IsUUID()
  coachId?: string;
}

export class EligibleCoachDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
}

export class ScheduledSessionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) sessionTypeId!: string;
  @ApiProperty() sessionTypeName!: string;
  @ApiProperty({ type: EligibleCoachDto }) coach!: EligibleCoachDto;
  @ApiProperty({ type: String, format: 'date-time' }) startsAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) endsAt!: Date;
  @ApiProperty() bufferMinutes!: number;
  @ApiProperty() capacity!: number;
  @ApiProperty() revision!: number;
  @ApiProperty({ enum: ['SCHEDULED', 'CANCELLED'] }) status!: 'SCHEDULED' | 'CANCELLED';
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) cancelledAt!: Date | null;
}

export class SchedulePageDto {
  @ApiProperty({ type: [ScheduledSessionDto] }) items!: ScheduledSessionDto[];
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) nextCursor!: string | null;
}

export class ScheduledSessionCreatedDto {
  @ApiProperty({ format: 'uuid' }) sessionId!: string;
}
