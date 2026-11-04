import { AccountState, PrismaClient, Role } from '@prisma/client';
import { hashPassword } from './identity/password';

async function seed() {
  if (process.env.NODE_ENV !== 'development') throw new Error('Local seed requires NODE_ENV=development');
  const url = new URL(process.env.MIGRATION_DATABASE_URL ?? '');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/strength_studio') {
    throw new Error('Local seed requires the loopback strength_studio database');
  }
  const email = process.env.LOCAL_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.LOCAL_ADMIN_PASSWORD;
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254
    || !password || password.length < 12 || password.length > 256) {
    throw new Error('Set LOCAL_ADMIN_EMAIL and a 12–256 character LOCAL_ADMIN_PASSWORD');
  }
  const db = new PrismaClient({ datasourceUrl: url.toString() });
  try {
    await db.user.create({ data: {
      normalizedEmail: email, passwordHash: await hashPassword(password), role: Role.ADMIN,
      accountState: AccountState.ACTIVE, emailVerifiedAt: new Date(),
    } });
    process.stdout.write('Local Admin fixture created.\n');
  } finally {
    await db.$disconnect();
  }
}

void seed().catch(() => {
  process.stderr.write('Local Admin seed failed. Check development mode, the loopback database, inputs, and whether this email already exists.\n');
  process.exitCode = 1;
});
