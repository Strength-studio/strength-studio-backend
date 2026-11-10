import { Injectable } from '@nestjs/common';
import { AuditAction, AuditTarget, PackageKind, PackageVersion, Prisma, Role } from '@prisma/client';
import { AccessContext, lockIdentity, Sessions } from '../identity/session.service';
import { audit } from '../platform/audit';
import { Commands } from '../platform/commands';
import { Database, databaseTime, Transaction } from '../platform/database';
import { failure } from '../platform/http';
import {
  ArchivePackageDto, ArchiveSessionTypeDto, CatalogPageDto, CreatePackageDto, CreateSessionTypeDto,
  CreateVersionDto, EditVersionDto, PackageTermsDto, PublishVersionDto,
} from './catalog.dto';

type CatalogWrite = { access: AccessContext; requestId: string; key?: string };
type Terms = PackageTermsDto;
type VersionWithEligibility = PackageVersion & { eligibility: { sessionTypeId: string }[] };
const issued = { publishedAt: { not: null }, supersededAt: null } satisfies Prisma.PackageVersionWhereInput;
const packageFields = { id: true, code: true, archivedAt: true } as const;
const typeFields = { id: true, code: true, name: true, mode: true } as const;
const versionFields = {
  id: true, packageId: true, version: true, name: true, description: true, price: true, currency: true,
  kind: true, validityDays: true, sessionAllowance: true, publishedAt: true,
  eligibility: { orderBy: { sessionTypeId: 'asc' }, select: { sessionType: { select: typeFields } } },
} satisfies Prisma.PackageVersionSelect;
const managementFields = { ...versionFields, draftRevision: true, basedOnVersionId: true, supersededAt: true } as const;
const packageActions: AuditAction[] = [
  AuditAction.CATALOG_CREATED, AuditAction.CATALOG_VERSION_CREATED, AuditAction.CATALOG_DRAFT_CHANGED,
  AuditAction.CATALOG_PUBLISHED, AuditAction.CATALOG_ARCHIVED,
];

function page<T>(rows: T[], limit: number, cursor: (item: T) => string) {
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? cursor(items[items.length - 1]) : null };
}

function presentVersion<T extends { price: Prisma.Decimal; eligibility: { sessionType: unknown }[] }>(row: T) {
  const { price, eligibility, ...version } = row;
  return { ...version, price: price.toFixed(2), sessionTypes: eligibility.map(link => link.sessionType) };
}

function normalizedChanges(dto: Terms): Terms;
function normalizedChanges(dto: Partial<Terms>): Partial<Terms>;
function normalizedChanges(dto: Partial<Terms>): Partial<Terms> {
  return {
    name: dto.name,
    description: dto.description,
    price: dto.price === undefined ? undefined : new Prisma.Decimal(dto.price).toFixed(2),
    kind: dto.kind,
    validityDays: dto.validityDays,
    sessionAllowance: dto.sessionAllowance,
    sessionTypeIds: dto.sessionTypeIds?.map(id => id.toLowerCase()).sort(),
  };
}

function storedTerms(terms: Terms) {
  const { sessionTypeIds, sessionAllowance, ...fields } = terms;
  const allowance = sessionAllowance ?? null;
  if ((fields.kind === PackageKind.SESSION) !== (allowance !== null)) {
    throw failure(400, 'INVALID_SESSION_ALLOWANCE');
  }
  return { fields: { ...fields, sessionAllowance: allowance }, sessionTypeIds };
}

function readTerms(version: VersionWithEligibility): Terms {
  return {
    name: version.name, description: version.description, price: version.price.toFixed(2), kind: version.kind,
    validityDays: version.validityDays, sessionAllowance: version.sessionAllowance,
    sessionTypeIds: version.eligibility.map(link => link.sessionTypeId),
  };
}

@Injectable()
export class CatalogService {
  constructor(private readonly db: Database, private readonly commands: Commands, private readonly sessions: Sessions) {}

  async listPublic(query: CatalogPageDto) {
    const rows = await this.db.packageVersion.findMany({
      where: { ...issued, package: { archivedAt: null }, packageId: query.after ? { gt: query.after } : undefined },
      orderBy: { packageId: 'asc' }, take: query.limit + 1,
      select: { ...versionFields, package: { select: { code: true } } },
    });
    return page(rows.map(({ package: offer, ...row }) => ({ ...presentVersion(row), code: offer.code })),
      query.limit, row => row.packageId);
  }

  async publicVersion(packageId: string, versionId: string) {
    const row = await this.db.packageVersion.findFirst({
      where: { id: versionId, packageId, ...issued, package: { archivedAt: null } },
      select: { ...versionFields, package: { select: { code: true } } },
    });
    if (!row) throw failure(404, 'CATALOG_VERSION_NOT_FOUND');
    const { package: offer, ...version } = row;
    return { ...presentVersion(version), code: offer.code };
  }

  async listManagement(query: CatalogPageDto) {
    const rows = await this.db.package.findMany({
      where: { id: query.after ? { gt: query.after } : undefined }, orderBy: { id: 'asc' }, take: query.limit + 1,
      select: { ...packageFields, versions: { where: issued, select: { id: true, version: true } } },
    });
    return page(rows.map(({ versions, ...offer }) => ({ ...offer,
      currentVersion: offer.archivedAt ? null : (versions[0] ?? null),
    })), query.limit, row => row.id);
  }

  async management(packageId: string, query: CatalogPageDto) {
    const offer = await this.getPackage(this.db, packageId);
    const cursor = query.after ? await this.getVersion(this.db, packageId, query.after) : null;
    const rows = await this.db.packageVersion.findMany({
      where: { packageId, version: cursor ? { lt: cursor.version } : undefined },
      orderBy: { version: 'desc' }, take: query.limit + 1, select: managementFields,
    });
    return { ...offer, ...page(rows.map(presentVersion), query.limit, row => row.id) };
  }

  async packageAudit(access: AccessContext, packageId: string, query: CatalogPageDto) {
    return this.db.command(async tx => {
      await lockIdentity(tx, access.userId, access.sessionId);
      await this.sessions.authorize(tx, access, ['catalog.manage']);
      await this.sessions.authorize(tx, access, ['audit.read']);
      await this.getPackage(tx, packageId);
      const where = { targetType: AuditTarget.PACKAGE, targetId: packageId, action: { in: packageActions } };
      if (query.after && !await tx.auditLog.findFirst({ where: { ...where, id: query.after }, select: { id: true } })) {
        throw failure(400, 'INVALID_CATALOG_CURSOR');
      }
      const rows = await tx.auditLog.findMany({
        where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit + 1,
        ...(query.after ? { cursor: { id: query.after }, skip: 1 } : {}),
        select: { id: true, createdAt: true, actorId: true, action: true, requestId: true, reason: true, redactedDetails: true },
      });
      return page(rows.map(({ redactedDetails, ...row }) => {
        const details = redactedDetails && typeof redactedDetails === 'object' && !Array.isArray(redactedDetails)
          ? redactedDetails : {};
        return { ...row, details: {
          versionId: details.versionId, basedOnVersionId: details.basedOnVersionId,
          previousVersionId: details.previousVersionId, version: details.version,
          draftRevision: details.draftRevision, effectiveAt: details.effectiveAt, changedFields: details.changedFields,
        } };
      }), query.limit, row => row.id);
    });
  }

  async listSessionTypes(query: CatalogPageDto) {
    const rows = await this.db.sessionType.findMany({
      where: { archivedAt: null, id: query.after ? { gt: query.after } : undefined },
      orderBy: { id: 'asc' }, take: query.limit + 1, select: typeFields,
    });
    return page(rows, query.limit, row => row.id);
  }

  async createPackage(ctx: CatalogWrite, dto: CreatePackageDto) {
    const terms = normalizedChanges(dto);
    const outcome = await this.run(ctx, 'package.create', [dto.code, terms], async tx => {
      const offer = await tx.package.create({ data: { code: dto.code }, select: { id: true } });
      const versionId = await this.insertDraft(tx, ctx, offer.id, 1, null, terms);
      await this.packageEvent(tx, ctx, AuditAction.CATALOG_CREATED, offer.id, { versionId, version: 1 });
      return { status: 201, reference: offer.id };
    });
    return { packageId: outcome.reference };
  }

  async createVersion(ctx: CatalogWrite, packageId: string, dto: CreateVersionDto) {
    const baseId = dto.expectedCurrentVersionId.toLowerCase();
    const terms = dto.terms === null ? null : normalizedChanges(dto.terms);
    const outcome = await this.run(ctx, 'version.create', [packageId, baseId, terms], async tx => {
      await this.lockPackage(tx, packageId);
      const current = await this.currentVersion(tx, packageId);
      if (!current || current.id !== baseId) throw failure(409, 'CATALOG_CURRENT_VERSION_CHANGED');
      const latest = await tx.packageVersion.findFirstOrThrow({
        where: { packageId }, orderBy: { version: 'desc' }, select: { version: true },
      });
      const version = latest.version + 1;
      const versionId = await this.insertDraft(tx, ctx, packageId, version, baseId,
        terms ?? readTerms(await this.getVersion(tx, packageId, baseId)));
      await this.packageEvent(tx, ctx, AuditAction.CATALOG_VERSION_CREATED, packageId, { versionId, version, basedOnVersionId: baseId });
      return { status: 201, reference: versionId };
    }, async tx => { await this.getPackage(tx, packageId); });
    return { versionId: outcome.reference };
  }

  async editVersion(ctx: CatalogWrite, packageId: string, versionId: string, dto: EditVersionDto) {
    const changes = normalizedChanges(dto);
    const changedFields = Object.keys(changes).filter(key => changes[key as keyof Terms] !== undefined);
    if (!changedFields.length) throw failure(400, 'EMPTY_CATALOG_EDIT');
    await this.run(ctx, 'version.edit', [packageId, versionId, dto.expectedDraftRevision, changes], async tx => {
      await this.lockPackage(tx, packageId);
      const draft = await this.getDraft(tx, packageId, versionId, dto.expectedDraftRevision);
      const terms = readTerms(draft);
      const changedTerms = Object.fromEntries(changedFields.map(key => [key, changes[key as keyof Terms]]));
      const { fields, sessionTypeIds } = storedTerms({ ...terms, ...changedTerms });
      const draftRevision = draft.draftRevision + 1;
      await tx.packageVersion.update({ where: { id: versionId }, data: { ...fields, draftRevision } });
      if (changes.sessionTypeIds !== undefined) {
        await this.lockActiveTypes(tx, sessionTypeIds, 400);
        await tx.packageVersionSessionType.deleteMany({ where: { packageVersionId: versionId } });
        await this.attachTypes(tx, versionId, sessionTypeIds);
      }
      await this.sessions.authorize(tx, ctx.access, ['catalog.manage']);
      await this.packageEvent(tx, ctx, AuditAction.CATALOG_DRAFT_CHANGED, packageId, { versionId, draftRevision, changedFields });
      return { status: 204 };
    }, async tx => { await this.getVersion(tx, packageId, versionId); });
  }

  async publishVersion(ctx: CatalogWrite, packageId: string, versionId: string, dto: PublishVersionDto) {
    const baseId = dto.expectedCurrentVersionId?.toLowerCase() ?? null;
    await this.run(ctx, 'version.publish', [packageId, versionId, dto.expectedDraftRevision, baseId], async tx => {
      await this.lockPackage(tx, packageId);
      const draft = await this.getDraft(tx, packageId, versionId, dto.expectedDraftRevision);
      const current = await this.currentVersion(tx, packageId);
      if ((current?.id ?? null) !== baseId || draft.basedOnVersionId !== baseId) {
        throw failure(409, 'CATALOG_CURRENT_VERSION_CHANGED');
      }
      const sessionTypeIds = draft.eligibility.map(link => link.sessionTypeId);
      if (!sessionTypeIds.length) throw failure(409, 'CATALOG_ELIGIBILITY_REQUIRED');
      await this.lockActiveTypes(tx, sessionTypeIds, 409);
      await this.checkPublisher(tx, ctx.access, draft.price);
      const now = await databaseTime(tx);
      if (current) await tx.packageVersion.update({ where: { id: current.id }, data: { supersededAt: now } });
      await tx.packageVersion.update({ where: { id: versionId }, data: { publishedAt: now } });
      await this.packageEvent(tx, ctx, AuditAction.CATALOG_PUBLISHED, packageId, {
        versionId, version: draft.version, draftRevision: draft.draftRevision,
        previousVersionId: current?.id ?? null, effectiveAt: now.toISOString(),
      });
      return { status: 204 };
    }, async tx => {
      const version = await this.getVersion(tx, packageId, versionId);
      await this.checkPublisher(tx, ctx.access, version.price);
    });
  }

  async archivePackage(ctx: CatalogWrite, packageId: string, dto: ArchivePackageDto) {
    const baseId = dto.expectedCurrentVersionId?.toLowerCase() ?? null;
    await this.run(ctx, 'package.archive', [packageId, baseId, dto.reason], async tx => {
      await this.lockPackage(tx, packageId);
      const current = await this.currentVersion(tx, packageId);
      if ((current?.id ?? null) !== baseId) throw failure(409, 'CATALOG_CURRENT_VERSION_CHANGED');
      await this.sessions.authorize(tx, ctx.access, ['catalog.manage']);
      const now = await databaseTime(tx);
      await tx.package.update({ where: { id: packageId }, data: { archivedAt: now } });
      await this.packageEvent(tx, ctx, AuditAction.CATALOG_ARCHIVED, packageId, {
        versionId: current?.id ?? null, effectiveAt: now.toISOString(),
      }, dto.reason);
      return { status: 204 };
    }, async tx => { await this.getPackage(tx, packageId); });
  }

  async createSessionType(ctx: CatalogWrite, dto: CreateSessionTypeDto) {
    const data = { code: dto.code, name: dto.name, mode: dto.mode };
    const outcome = await this.run(ctx, 'session-type.create', [data], async tx => {
      const type = await tx.sessionType.create({ data, select: { id: true } });
      await this.typeEvent(tx, ctx, type.id, 'created');
      return { status: 201, reference: type.id };
    }, async tx => { await this.requireAdmin(tx, ctx.access); });
    return { sessionTypeId: outcome.reference };
  }

  async archiveSessionType(ctx: CatalogWrite, sessionTypeId: string, dto: ArchiveSessionTypeDto) {
    await this.run(ctx, 'session-type.archive', [sessionTypeId, dto.reason], async tx => {
      const [type] = await tx.$queryRaw<{ archived_at: Date | null }[]>`
        SELECT archived_at FROM session_type WHERE id = ${sessionTypeId}::uuid FOR NO KEY UPDATE`;
      if (!type) throw failure(404, 'SESSION_TYPE_NOT_FOUND');
      if (type.archived_at) throw failure(409, 'SESSION_TYPE_ARCHIVED');
      await this.requireAdmin(tx, ctx.access);
      await tx.sessionType.update({ where: { id: sessionTypeId }, data: { archivedAt: await databaseTime(tx) } });
      await this.typeEvent(tx, ctx, sessionTypeId, 'archived', dto.reason);
      return { status: 204 };
    }, async tx => { await this.requireAdmin(tx, ctx.access); });
  }

  private async run(ctx: CatalogWrite, operation: string, args: readonly unknown[],
    write: (tx: Transaction) => Promise<{ status: number; reference?: string }>,
    scope?: (tx: Transaction) => Promise<void>) {
    try {
      return await this.commands.run({ access: ctx.access, action: 'catalog.manage', key: ctx.key,
        operation: 'catalog.' + operation, args, write, scope });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const isCode = operation === 'package.create' || operation === 'session-type.create';
        throw failure(409, isCode ? 'CATALOG_CODE_EXISTS' : 'CATALOG_CONFLICT');
      }
      throw error;
    }
  }

  private async getPackage(tx: Transaction, packageId: string) {
    const row = await tx.package.findUnique({ where: { id: packageId }, select: packageFields });
    if (!row) throw failure(404, 'CATALOG_PACKAGE_NOT_FOUND');
    return row;
  }

  private async lockPackage(tx: Transaction, packageId: string) {
    const [row] = await tx.$queryRaw<{ archived_at: Date | null }[]>`
      SELECT archived_at FROM package WHERE id = ${packageId}::uuid FOR NO KEY UPDATE`;
    if (!row) throw failure(404, 'CATALOG_PACKAGE_NOT_FOUND');
    if (row.archived_at) throw failure(409, 'CATALOG_PACKAGE_ARCHIVED');
  }

  private async getVersion(tx: Transaction, packageId: string, versionId: string) {
    const row = await tx.packageVersion.findUnique({
      where: { packageId_id: { packageId, id: versionId } },
      include: { eligibility: { orderBy: { sessionTypeId: 'asc' }, select: { sessionTypeId: true } } },
    });
    if (!row) throw failure(404, 'CATALOG_VERSION_NOT_FOUND');
    return row;
  }

  private async getDraft(tx: Transaction, packageId: string, versionId: string, revision: number) {
    await tx.$queryRaw`
      SELECT id FROM package_version WHERE package_id = ${packageId}::uuid AND id = ${versionId}::uuid FOR NO KEY UPDATE`;
    const row = await this.getVersion(tx, packageId, versionId);
    if (row.publishedAt) throw failure(409, 'CATALOG_VERSION_ISSUED');
    if (row.draftRevision !== revision) throw failure(409, 'CATALOG_DRAFT_CHANGED');
    return row;
  }

  private currentVersion(tx: Transaction, packageId: string) {
    return tx.packageVersion.findFirst({ where: { packageId, ...issued }, select: { id: true } });
  }

  private async lockActiveTypes(tx: Transaction, ids: string[], invalidStatus: number) {
    if (!ids.length) return;
    const uuids = Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`));
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM session_type WHERE id IN (${uuids}) AND archived_at IS NULL ORDER BY id FOR NO KEY UPDATE`;
    if (rows.length !== ids.length) throw failure(invalidStatus, 'INVALID_SESSION_TYPE');
  }

  private async insertDraft(tx: Transaction, ctx: CatalogWrite, packageId: string, version: number,
    basedOnVersionId: string | null, terms: Terms) {
    const { fields, sessionTypeIds } = storedTerms(terms);
    const row = await tx.packageVersion.create({ data: { ...fields, packageId, version, basedOnVersionId }, select: { id: true } });
    await this.lockActiveTypes(tx, sessionTypeIds, 400);
    await this.sessions.authorize(tx, ctx.access, ['catalog.manage']);
    await this.attachTypes(tx, row.id, sessionTypeIds);
    return row.id;
  }

  private async attachTypes(tx: Transaction, versionId: string, ids: string[]) {
    if (ids.length) await tx.packageVersionSessionType.createMany({
      data: ids.map(sessionTypeId => ({ packageVersionId: versionId, sessionTypeId })),
    });
  }

  private async requireAdmin(tx: Transaction, access: AccessContext) {
    const { user } = await this.sessions.authorize(tx, access, ['catalog.manage']);
    if (user.role !== Role.ADMIN) throw failure(403, 'FORBIDDEN');
  }

  private async checkPublisher(tx: Transaction, access: AccessContext, price: Prisma.Decimal) {
    const { user } = await this.sessions.authorize(tx, access, ['catalog.manage']);
    if (price.isZero() && user.role !== Role.ADMIN) throw failure(403, 'FORBIDDEN');
  }

  private packageEvent(tx: Transaction, ctx: CatalogWrite, action: AuditAction, packageId: string,
    redactedDetails: Prisma.InputJsonObject, reason?: string) {
    return audit(tx, { actorId: ctx.access.userId, requestId: ctx.requestId, action,
      targetType: AuditTarget.PACKAGE, targetId: packageId, redactedDetails, reason });
  }

  private typeEvent(tx: Transaction, ctx: CatalogWrite, sessionTypeId: string, operation: 'created' | 'archived', reason?: string) {
    return audit(tx, { actorId: ctx.access.userId, requestId: ctx.requestId, action: AuditAction.CATALOG_REFERENCE_CHANGED,
      targetType: AuditTarget.SESSION_TYPE, targetId: sessionTypeId, redactedDetails: { operation }, reason });
  }
}
