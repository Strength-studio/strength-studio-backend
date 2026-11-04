import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ format: 'email', maxLength: 254 })
  @IsEmail() @MaxLength(254) email!: string;

  @ApiProperty({ format: 'password', maxLength: 256, writeOnly: true })
  @IsString() @Length(1, 256) password!: string;
}

export class RefreshDto {
  @ApiProperty({ writeOnly: true })
  @IsString() @Length(43, 43) refreshToken!: string;
}

export class LogoutDto {
  @ApiProperty({ writeOnly: true, required: false })
  @IsOptional() @IsString() @Length(43, 43) refreshToken?: string;
}

export class InviteClientDto {
  @ApiProperty({ format: 'email', maxLength: 254 })
  @IsEmail() @MaxLength(254) email!: string;

  @ApiProperty({ maxLength: 120 })
  @IsString() @Length(1, 120) displayName!: string;
}

export class GrantDto {
  @ApiProperty()
  @IsBoolean() enabled!: boolean;
}

export class ExceptionDto {
  @ApiProperty({ maxLength: 500 })
  @IsString() @MinLength(1) @MaxLength(500) reason!: string;
}

export class TokenPairDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty() refreshToken!: string;
  @ApiProperty() expiresIn!: number;
  @ApiProperty({ format: 'date-time' }) refreshExpiresAt!: string;
}
