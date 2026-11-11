import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AccountState } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsString, Matches, Max, Min, ValidateIf } from 'class-validator';

export class ClientListQuery {
  @ApiPropertyOptional({ type: 'integer', default: 20, minimum: 1, maximum: 100 })
  @Transform(({ value }) => typeof value === 'string' && /^[1-9][0-9]{0,2}$/.test(value) ? Number(value) : value)
  @IsInt() @Min(1) @Max(100)
  limit = 20;

  @ApiPropertyOptional({ description: 'Opaque nextCursor from the preceding page', minLength: 48, maxLength: 48 })
  @ValidateIf((_, value) => value !== undefined)
  @IsString() @Matches(/^[A-Za-z0-9_-]{48}$/)
  after?: string;

  @ApiPropertyOptional({ description: 'Case-insensitive name or email prefix', minLength: 1, maxLength: 120 })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Matches(/^[^\u0000-\u001f\u007f]{1,120}$/)
  q?: string;

  @ApiPropertyOptional({ enum: AccountState })
  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(AccountState)
  accountState?: AccountState;

  @ApiPropertyOptional({ type: Boolean })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(({ value }) => value === 'true' ? true : value === 'false' ? false : value)
  @IsBoolean()
  emailVerified?: boolean;
}

export class ClientSelfProfileDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ format: 'email' }) email!: string;
}

export class ClientDirectoryItemDto extends ClientSelfProfileDto {
  @ApiProperty({ enum: AccountState }) accountState!: AccountState;
  @ApiProperty() emailVerified!: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
}

export class ClientDetailDto extends ClientDirectoryItemDto {
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) emailVerifiedAt!: Date | null;
}

export class ClientPageDto {
  @ApiProperty({ type: [ClientDirectoryItemDto] }) items!: ClientDirectoryItemDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}
