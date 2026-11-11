import { Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { AccessContext, Sessions } from '../identity/session.service';
import { Database } from '../platform/database';
import { failure } from '../platform/http';
import { ClientListQuery } from './client.dto';

const clientScope = { user: { role: Role.CLIENT } } satisfies Prisma.ClientProfileWhereInput;
const profileFields = {
  userId: true, displayName: true, user: { select: { normalizedEmail: true } },
} satisfies Prisma.ClientProfileSelect;
const directoryFields = {
  ...profileFields, createdAt: true,
  user: { select: { ...profileFields.user.select, accountState: true, emailVerifiedAt: true } },
} satisfies Prisma.ClientProfileSelect;

function profile(row: Prisma.ClientProfileGetPayload<{ select: typeof profileFields }>) {
  return { id: row.userId, displayName: row.displayName, email: row.user.normalizedEmail };
}

function directoryItem(row: Prisma.ClientProfileGetPayload<{ select: typeof directoryFields }>) {
  return {
    ...profile(row), accountState: row.user.accountState,
    emailVerified: row.user.emailVerifiedAt !== null, createdAt: row.createdAt,
  };
}

function decodeCursor(value: string) {
  const id = Buffer.from(value, 'base64url').toString('utf8');
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id)) throw failure(400, 'INVALID_CLIENT_CURSOR');
  return id;
}

@Injectable()
export class ClientService {
  constructor(private readonly db: Database, private readonly sessions: Sessions) {}

  async list(query: ClientListQuery) {
    // Prisma implements startsWith using LIKE or ILIKE. Treat wildcard characters as literal input.
    const prefix = query.q?.replace(/[\\%_]/g, '\\$&');
    const where: Prisma.ClientProfileWhereInput = {
      user: {
        ...clientScope.user,
        accountState: query.accountState,
        emailVerifiedAt: query.emailVerified === undefined ? undefined : query.emailVerified ? { not: null } : null,
      },
      ...(prefix ? { OR: [
        { displayName: { startsWith: prefix, mode: 'insensitive' } },
        { user: { normalizedEmail: { startsWith: prefix, mode: 'insensitive' } } },
      ] } : {}),
    };
    const after = query.after ? decodeCursor(query.after) : undefined;
    if (after && !await this.db.clientProfile.findFirst({ where: { ...where, userId: after }, select: { userId: true } })) {
      throw failure(400, 'INVALID_CLIENT_CURSOR');
    }
    const rows = await this.db.clientProfile.findMany({
      // Exclude the anchor by ID so a concurrent state change cannot cause an extra row to be skipped.
      where: after ? { ...where, userId: { not: after } } : where,
      select: directoryFields, orderBy: [{ createdAt: 'desc' }, { userId: 'desc' }],
      take: query.limit + 1, ...(after ? { cursor: { userId: after } } : {}),
    });
    const items = rows.slice(0, query.limit).map(directoryItem);
    const nextCursor = rows.length > query.limit
      ? Buffer.from(items[items.length - 1].id).toString('base64url') : null;
    return { items, nextCursor };
  }

  async detail(id: string) {
    const row = await this.db.clientProfile.findFirst({ where: { ...clientScope, userId: id }, select: directoryFields });
    if (!row) throw failure(404, 'CLIENT_NOT_FOUND');
    return { ...directoryItem(row), emailVerifiedAt: row.user.emailVerifiedAt };
  }

  async ownProfile(access: AccessContext) {
    const { user } = await this.sessions.authorize(this.db, access, ['account.self']);
    if (user.role !== Role.CLIENT) throw failure(403, 'FORBIDDEN');
    const row = await this.db.clientProfile.findFirst({
      where: { ...clientScope, userId: user.id }, select: profileFields,
    });
    if (!row) throw failure(404, 'CLIENT_NOT_FOUND');
    return profile(row);
  }
}
