import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags,
  ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AccessContext } from '../identity/session.service';
import { CurrentAccess, RequireAction } from '../platform/http';
import { ClientDetailDto, ClientListQuery, ClientPageDto, ClientSelfProfileDto } from './client.dto';
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

  @Get('me/client-profile') @RequireAction('account.self')
  @ApiOperation({ summary: 'Read your Client profile', description: 'Requires an authenticated Client account.' })
  @ApiOkResponse({ type: ClientSelfProfileDto })
  @ApiBadRequestResponse({ description: 'Unexpected query parameters' })
  @ApiNotFoundResponse()
  ownProfile(@CurrentAccess() access: AccessContext, @Query() _query: EmptyQuery) {
    return this.clients.ownProfile(access);
  }
}
