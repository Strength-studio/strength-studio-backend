import { AuditAction, AuditTarget, Prisma } from '@prisma/client';
import { Transaction } from './database';

export async function audit(tx: Transaction, event: {
  actorId: string; action: AuditAction; targetType: AuditTarget; targetId: string;
  requestId: string; redactedDetails?: Prisma.InputJsonObject;
}) {
  await tx.auditLog.create({ data: { ...event, redactedDetails: event.redactedDetails ?? {} } });
}
