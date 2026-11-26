import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsUUID, Max, Min, ValidateIf } from 'class-validator';

export class PurchaseAuditQuery {
  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 50, default: 50 })
  @Transform(({ value }) => typeof value === 'string' && /^(?:[1-9]|[1-4][0-9]|50)$/.test(value) ? Number(value) : value)
  @IsInt() @Min(1) @Max(50) limit = 50;

  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_, value) => value !== undefined) @IsUUID() after?: string;
}

export class PurchaseAuditEventDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) actorId!: string | null;
  @ApiProperty() action!: string;
  @ApiProperty() targetType!: string;
  @ApiProperty({ format: 'uuid' }) targetId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) requestId!: string | null;
  @ApiProperty({ type: String, nullable: true }) reason!: string | null;
}

export class PurchaseAuditPageDto {
  @ApiProperty({ type: [PurchaseAuditEventDto] }) items!: PurchaseAuditEventDto[];
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) nextCursor!: string | null;
}
