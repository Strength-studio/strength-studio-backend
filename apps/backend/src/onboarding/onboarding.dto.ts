import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsInt, IsString, Length, Matches, MaxLength, Min } from 'class-validator';

export class InviteDto {
  @ApiProperty({ format: 'email', maxLength: 254 })
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail() @MaxLength(254) email!: string;
  @ApiProperty({ minLength: 1, maxLength: 120 })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Matches(/^[^\u0000-\u001f\u007f]{1,120}$/) displayName!: string;
}
export class ProofDto {
  @ApiProperty({ writeOnly: true, minLength: 43, maxLength: 43 })
  @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/) token!: string;
}
export class PasswordSetupDto extends ProofDto {
  @ApiProperty({ writeOnly: true, minLength: 12, maxLength: 256 })
  @IsString() @Length(12, 256) password!: string;
}
export class ResendProofDto {
  @ApiProperty({ format: 'email', maxLength: 254 })
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail() @MaxLength(254) email!: string;
}
export class OnboardingCommandDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedRevision!: number;
  @ApiProperty({ minLength: 1, maxLength: 500 })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Length(1, 500) reason!: string;
}
export class EmptyOnboardingQuery { }
export class InvitationDto {
  @ApiProperty({ format: 'uuid' }) clientId!: string;
  @ApiProperty({ format: 'uuid' }) challengeId!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: Date;
  @ApiProperty() linkAvailable!: boolean;
  @ApiProperty({ required: false, writeOnly: true }) setupLink?: string;
}
export class AcceptedDto { @ApiProperty() accepted!: boolean; }
export class PasswordAuthorizationDto {
  @ApiProperty({ writeOnly: true }) token!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: Date;
}
export class OnboardingStatusDto {
  @ApiProperty({ enum: ['NOT_STARTED', 'INVITED', 'VERIFY_EMAIL', 'SET_PASSWORD', 'COMPLETED', 'REVOKED', 'DISABLED'] }) status!: string;
  @ApiProperty({ required: false }) revision?: number;
  @ApiProperty({ required: false, nullable: true, type: String, format: 'date-time' }) expiresAt?: Date | null;
  @ApiProperty({ required: false, nullable: true, type: String, format: 'date-time' }) canReissueAt?: Date | null;
  @ApiProperty({ required: false, nullable: true, enum: ['QUEUED', 'ACCEPTED', 'FAILED', null] }) delivery?: string | null;
}
