import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Query, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiConflictResponse, ApiForbiddenResponse, ApiHeader, ApiNoContentResponse,
  ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AccessContext } from '../identity/session.service';
import { CurrentAccess, RequireAction, StudioRequest } from '../platform/http';
import { ClientDetailDto, ClientListQuery, ClientPageDto, ClientSelfProfileDto, UpdateClientProfileDto } from './client.dto';
import { ClientService } from './client.service';

class EmptyQuery {}

@ApiTags('Clients')
@ApiBearerAuth()
@ApiUnauthorizedResponse()
@ApiForbiddenResponse()
@Controller()
export class ClientController {
  constructor(private readonly clients: ClientService) {}

  @Get('clients') @RequireAction('client.manage')
  @ApiOperation({ summary: 'List Client profiles', description: 'Requires client.manage.' })
  @ApiOkResponse({ type: ClientPageDto })
  @ApiBadRequestResponse({ description: 'Invalid query parameters or cursor' })
  list(@Query() query: ClientListQuery) {
    return this.clients.list(query);
  }

  @Get('clients/:id') @RequireAction('client.manage')
  @ApiOperation({ summary: 'Read a Client profile for management', description: 'Requires client.manage.' })
  @ApiOkResponse({ type: ClientDetailDto })
  @ApiBadRequestResponse({ description: 'Invalid Client ID or unexpected query parameters' })
  @ApiNotFoundResponse()
  detail(@Param('id', ParseUUIDPipe) id: string, @Query() _query: EmptyQuery) {
    return this.clients.detail(id.toLowerCase());
  }

  @Patch('clients/:id') @RequireAction('user.manage') @HttpCode(204)
  @ApiOperation({ summary: 'Update an existing Client display name', description: 'Admin-only user.manage. No onboarding, email, role or account-state changes.' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ description: 'Invalid input or idempotency key' })
  @ApiNotFoundResponse({ description: 'CLIENT_NOT_FOUND' })
  @ApiConflictResponse({ description: 'CLIENT_PROFILE_CHANGED, IDEMPOTENCY_KEY_REUSED or IDEMPOTENCY_KEY_EXPIRED' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateClientProfileDto,
    @Query() _query: EmptyQuery, @Headers('idempotency-key') key: string | undefined,
    @CurrentAccess() access: AccessContext, @Req() req: StudioRequest) {
    return this.clients.update(id.toLowerCase(), dto, access, key, req.requestId);
  }

  @Get('me/client-profile') @RequireAction('account.self')
  @ApiOperation({ summary: 'Read your Client profile', description: 'Requires an authenticated Client account.' })
  @ApiOkResponse({ type: ClientSelfProfileDto })
  @ApiBadRequestResponse({ description: 'Unexpected query parameters' })
  @ApiNotFoundResponse()
  ownProfile(@CurrentAccess() access: AccessContext, @Query() _query: EmptyQuery) {
    return this.clients.ownProfile(access);
  }
}
