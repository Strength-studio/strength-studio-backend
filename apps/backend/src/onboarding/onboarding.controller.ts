import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiConflictResponse, ApiForbiddenResponse, ApiHeader,
  ApiNoContentResponse, ApiAcceptedResponse, ApiOkResponse, ApiCreatedResponse, ApiTags, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AccessContext } from '../identity/session.service';
import { CurrentAccess, Public, RequireAction, StudioRequest } from '../platform/http';
import { AcceptedDto, EmptyOnboardingQuery, InvitationDto, InviteDto, OnboardingCommandDto,
  OnboardingStatusDto, PasswordAuthorizationDto, PasswordSetupDto, ProofDto, ResendProofDto } from './onboarding.dto';
import { OnboardingService } from './onboarding.service';

@ApiTags('Client onboarding')
@ApiBadRequestResponse({ description: 'INVALID_INPUT or CHALLENGE_INVALID_OR_EXPIRED' })
@ApiConflictResponse({ description: 'CLIENT_IDENTITY_CONFLICT, ONBOARDING_CHANGED, ONBOARDING_NOT_ELIGIBLE, ONBOARDING_RATE_LIMITED or idempotency conflict' })
@Controller()
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Post('users/invite') @RequireAction('user.manage') @ApiBearerAuth()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Admin creates a Client and discloses its manual setup link once' })
  @ApiCreatedResponse({ type: InvitationDto }) @ApiForbiddenResponse()
  invite(@Body() dto: InviteDto, @Query() _query: EmptyOnboardingQuery, @CurrentAccess() access: AccessContext,
    @Headers('idempotency-key') key: string | undefined, @Req() req: StudioRequest) {
    return this.onboarding.invite(dto, access, key, req.requestId);
  }
  @Get('clients/:id/onboarding') @RequireAction('user.manage') @ApiBearerAuth()
  @ApiOkResponse({ type: OnboardingStatusDto }) @ApiForbiddenResponse()
  status(@Param('id', ParseUUIDPipe) id: string, @Query() _query: EmptyOnboardingQuery, @CurrentAccess() access: AccessContext) {
    return this.onboarding.status(id.toLowerCase(), access);
  }
  @Post('users/:id/onboarding/reissue') @RequireAction('user.manage') @ApiBearerAuth() @HttpCode(200)
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiOkResponse({ type: InvitationDto })
  reissue(@Param('id', ParseUUIDPipe) id: string, @Body() dto: OnboardingCommandDto,
    @Query() _query: EmptyOnboardingQuery, @CurrentAccess() access: AccessContext,
    @Headers('idempotency-key') key: string | undefined, @Req() req: StudioRequest) {
    return this.onboarding.manage(id.toLowerCase(), 'reissue', dto, access, key, req.requestId);
  }
  @Post('users/:id/onboarding/revoke') @RequireAction('user.manage') @ApiBearerAuth() @HttpCode(204)
  @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiNoContentResponse()
  revoke(@Param('id', ParseUUIDPipe) id: string, @Body() dto: OnboardingCommandDto,
    @Query() _query: EmptyOnboardingQuery, @CurrentAccess() access: AccessContext,
    @Headers('idempotency-key') key: string | undefined, @Req() req: StudioRequest) {
    return this.onboarding.manage(id.toLowerCase(), 'revoke', dto, access, key, req.requestId);
  }
  @Post('auth/accept-invitation') @Public() @HttpCode(202)
  @Throttle({ default: { limit: 10, ttl: 60_000 } }) @ApiAcceptedResponse({ type: AcceptedDto })
  accept(@Body() dto: ProofDto, @Query() _query: EmptyOnboardingQuery, @Req() req: StudioRequest) {
    return this.onboarding.accept(dto.token, req.requestId);
  }
  @Post('auth/verify-email') @Public() @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } }) @ApiOkResponse({ type: PasswordAuthorizationDto })
  verify(@Body() dto: ProofDto, @Query() _query: EmptyOnboardingQuery, @Req() req: StudioRequest) {
    return this.onboarding.verify(dto.token, req.requestId);
  }
  @Post('auth/setup-password') @Public() @HttpCode(204)
  @Throttle({ default: { limit: 10, ttl: 60_000 } }) @ApiNoContentResponse()
  password(@Body() dto: PasswordSetupDto, @Query() _query: EmptyOnboardingQuery, @Req() req: StudioRequest) {
    return this.onboarding.password(dto.token, dto.password, req.requestId);
  }
  @Post('auth/resend-verification') @Public() @HttpCode(202)
  @Throttle({ default: { limit: 10, ttl: 60_000 } }) @ApiAcceptedResponse({ type: AcceptedDto })
  resend(@Body() dto: ResendProofDto, @Query() _query: EmptyOnboardingQuery, @Req() req: StudioRequest) {
    return this.onboarding.resend(dto.email, req.requestId);
  }
}
