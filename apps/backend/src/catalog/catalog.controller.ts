import { applyDecorators, Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiConflictResponse, ApiHeader, ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import { RequireAction, StudioRequest } from '../platform/http';
import {
  ArchivePackageDto, ArchiveSessionTypeDto, CatalogPageDto, CreatePackageDto, CreateSessionTypeDto,
  CreateVersionDto, EditVersionDto, PublishVersionDto,
} from './catalog.dto';
import { CatalogService } from './catalog.service';

const CatalogWrite = () => applyDecorators(
  RequireAction('catalog.manage'),
  ApiHeader({ name: 'Idempotency-Key', required: true }),
);

function command(req: StudioRequest, key: string | undefined) {
  return { access: req.access!, requestId: req.requestId, key };
}

@ApiTags('Public catalog')
@ApiBearerAuth()
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('packages') @RequireAction('catalog.read')
  listPublic(@Query() query: CatalogPageDto) {
    return this.catalog.listPublic(query);
  }

  @Get('packages/management') @RequireAction('catalog.manage')
  listManagement(@Query() query: CatalogPageDto) {
    return this.catalog.listManagement(query);
  }

  @Get('packages/:packageId/versions/:versionId') @RequireAction('catalog.read')
  publicVersion(@Param('packageId', ParseUUIDPipe) packageId: string, @Param('versionId', ParseUUIDPipe) versionId: string) {
    return this.catalog.publicVersion(packageId.toLowerCase(), versionId.toLowerCase());
  }

  @Get('packages/:packageId/management') @RequireAction('catalog.manage')
  management(@Param('packageId', ParseUUIDPipe) packageId: string, @Query() query: CatalogPageDto) {
    return this.catalog.management(packageId.toLowerCase(), query);
  }

  @Get('packages/:packageId/management/audit') @RequireAction('catalog.manage')
  packageAudit(@Param('packageId', ParseUUIDPipe) packageId: string, @Query() query: CatalogPageDto, @Req() req: StudioRequest) {
    return this.catalog.packageAudit(req.access!, packageId.toLowerCase(), query);
  }

  @Post('packages') @CatalogWrite()
  createPackage(@Body() dto: CreatePackageDto, @Headers('idempotency-key') key: string | undefined, @Req() req: StudioRequest) {
    return this.catalog.createPackage(command(req, key), dto);
  }

  @Post('packages/:packageId/versions') @CatalogWrite()
  createVersion(@Param('packageId', ParseUUIDPipe) packageId: string, @Body() dto: CreateVersionDto,
    @Headers('idempotency-key') key: string | undefined, @Req() req: StudioRequest) {
    return this.catalog.createVersion(command(req, key), packageId.toLowerCase(), dto);
  }

  @Patch('packages/:packageId/versions/:versionId') @CatalogWrite() @HttpCode(204)
  editVersion(@Param('packageId', ParseUUIDPipe) packageId: string, @Param('versionId', ParseUUIDPipe) versionId: string,
    @Body() dto: EditVersionDto, @Headers('idempotency-key') key: string | undefined, @Req() req: StudioRequest) {
    return this.catalog.editVersion(command(req, key), packageId.toLowerCase(), versionId.toLowerCase(), dto);
  }

  @Post('packages/:packageId/versions/:versionId/publish') @CatalogWrite() @HttpCode(204)
  @ApiNoContentResponse()
  @ApiConflictResponse({ description: 'The draft, eligibility or current version changed' })
  publishVersion(@Param('packageId', ParseUUIDPipe) packageId: string, @Param('versionId', ParseUUIDPipe) versionId: string,
    @Body() dto: PublishVersionDto, @Headers('idempotency-key') key: string | undefined, @Req() req: StudioRequest) {
    return this.catalog.publishVersion(command(req, key), packageId.toLowerCase(), versionId.toLowerCase(), dto);
  }

  @Post('packages/:packageId/archive') @CatalogWrite() @HttpCode(204)
  archivePackage(@Param('packageId', ParseUUIDPipe) packageId: string, @Body() dto: ArchivePackageDto,
    @Headers('idempotency-key') key: string | undefined, @Req() req: StudioRequest) {
    return this.catalog.archivePackage(command(req, key), packageId.toLowerCase(), dto);
  }

  @Get('session-types') @RequireAction('catalog.read')
  listSessionTypes(@Query() query: CatalogPageDto) {
    return this.catalog.listSessionTypes(query);
  }

  @Post('session-types') @CatalogWrite()
  createSessionType(@Body() dto: CreateSessionTypeDto, @Headers('idempotency-key') key: string | undefined, @Req() req: StudioRequest) {
    return this.catalog.createSessionType(command(req, key), dto);
  }

  @Post('session-types/:sessionTypeId/archive') @CatalogWrite() @HttpCode(204)
  archiveSessionType(@Param('sessionTypeId', ParseUUIDPipe) sessionTypeId: string, @Body() dto: ArchiveSessionTypeDto,
    @Headers('idempotency-key') key: string | undefined, @Req() req: StudioRequest) {
    return this.catalog.archiveSessionType(command(req, key), sessionTypeId.toLowerCase(), dto);
  }
}
