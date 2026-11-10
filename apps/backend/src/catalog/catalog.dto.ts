import { ApiProperty, ApiPropertyOptional, IntersectionType, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayUnique, IsArray, IsDefined, IsEnum, IsInt, IsNotEmpty, IsObject, IsString,
  IsUUID, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested,
} from 'class-validator';
import { PackageKind, SessionTypeMode } from '@prisma/client';

const maxInt = 2_147_483_647;
const catalogCode = /^[A-Z0-9][A-Z0-9_-]{0,39}$/;

function trimmed(value: unknown) {
  return typeof value === 'string' ? value.trim() : value;
}

export class PackageTermsDto {
  @ApiProperty({ maxLength: 120 })
  @Transform(({ value }) => trimmed(value))
  @IsString() @IsNotEmpty() @MaxLength(120)
  name!: string;

  @ApiProperty({ maxLength: 2000 })
  @IsString() @MaxLength(2000)
  description!: string;

  @ApiProperty({ example: '150.00', description: 'Nonnegative SAR amount with at most two decimal places' })
  @IsString() @Matches(/^(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,2})?$/)
  price!: string;

  @ApiProperty({ enum: PackageKind })
  @IsEnum(PackageKind)
  kind!: PackageKind;

  @ApiProperty({ minimum: 1 })
  @IsInt() @Min(1) @Max(maxInt)
  validityDays!: number;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 1 })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsInt() @Min(1) @Max(maxInt)
  sessionAllowance?: number | null;

  @ApiProperty({ type: [String], maxItems: 50 })
  @IsArray() @ArrayMaxSize(50)
  @ArrayUnique((value: unknown) => typeof value === 'string' ? value.toLowerCase() : value)
  @IsUUID('all', { each: true })
  sessionTypeIds!: string[];
}

export class CreatePackageDto extends PackageTermsDto {
  @ApiProperty({ example: 'FOUNDATION-10' })
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @IsString() @Matches(catalogCode)
  code!: string;
}

export class CreateVersionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  expectedCurrentVersionId!: string;

  @ApiProperty({ type: PackageTermsDto, nullable: true, description: 'Send null to clone the current version' })
  @ValidateIf((_, value) => value !== null)
  @IsDefined() @IsObject() @ValidateNested() @Type(() => PackageTermsDto)
  terms!: PackageTermsDto | null;
}

export class EditVersionDto extends PartialType(PackageTermsDto, { skipNullProperties: false }) {
  @ApiProperty({ minimum: 1 })
  @IsInt() @Min(1) @Max(maxInt)
  expectedDraftRevision!: number;
}

class CurrentVersionDto {
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  expectedCurrentVersionId!: string | null;
}

export class PublishVersionDto extends CurrentVersionDto {
  @ApiProperty({ minimum: 1 })
  @IsInt() @Min(1) @Max(maxInt)
  expectedDraftRevision!: number;
}

export class ArchiveSessionTypeDto {
  @ApiPropertyOptional({ maxLength: 240 })
  @Transform(({ value }) => trimmed(value))
  @ValidateIf((_, value) => value !== undefined)
  @IsString() @IsNotEmpty() @MaxLength(240)
  reason?: string;
}

export class ArchivePackageDto extends IntersectionType(CurrentVersionDto, ArchiveSessionTypeDto) {}

export class CreateSessionTypeDto {
  @ApiProperty({ example: 'PERSONAL-TRAINING' })
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @IsString() @Matches(catalogCode)
  code!: string;

  @ApiProperty({ maxLength: 120 })
  @Transform(({ value }) => trimmed(value))
  @IsString() @IsNotEmpty() @MaxLength(120)
  name!: string;

  @ApiProperty({ enum: SessionTypeMode })
  @IsEnum(SessionTypeMode)
  mode!: SessionTypeMode;
}

export class CatalogPageDto {
  @ApiPropertyOptional({ type: Number, default: 20, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt() @Min(1) @Max(100)
  limit = 20;

  @ApiPropertyOptional({ format: 'uuid', description: 'Use the nextCursor from the preceding page' })
  @Transform(({ value }) => typeof value === 'string' ? value.toLowerCase() : value)
  @ValidateIf((_, value) => value !== undefined)
  @IsUUID()
  after?: string;
}
