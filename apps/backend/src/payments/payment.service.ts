import { Injectable } from '@nestjs/common';
import { AuditAction, AuditTarget, PaymentStatus, Prisma, Role } from '@prisma/client';
import { AccessContext, Sessions } from '../identity/session.service';
import { audit } from '../platform/audit';
import { Commands } from '../platform/commands';
import { databaseTime } from '../platform/database';
import { failure } from '../platform/http';
import { RecordPaymentDto } from './payment.dto';

const action = 'payment.record';

@Injectable()
export class PaymentService {
  constructor(private readonly commands: Commands, private readonly sessions: Sessions) {}

  async record(access: AccessContext, requestId: string, key: string | undefined, dto: RecordPaymentDto) {
    const clientId = dto.clientId.toLowerCase();
    const intakeId = dto.intakeId.toLowerCase();
    const amount = new Prisma.Decimal(dto.amount);
    if (!amount.gt(0)) throw failure(400, 'INVALID_INPUT');
    const receivedAt = new Date(dto.receivedAt);
    if (!Number.isFinite(receivedAt.valueOf()) || receivedAt.getUTCFullYear() < 1) throw failure(400, 'INVALID_INPUT');
    const { currency, method, reference = null, evidence = null } = dto;
    const outcome = await this.commands.run({
      access, action, key, targetUser: clientId,
      args: [clientId, intakeId, amount.toFixed(2), currency, method, receivedAt.toISOString(), reference, evidence],
      scope: async tx => {
        const client = await tx.clientProfile.findFirst({
          where: { userId: clientId, user: { role: Role.CLIENT } }, select: { userId: true },
        });
        if (!client) throw failure(404, 'CLIENT_NOT_FOUND');
      },
      write: async tx => {
        const createdAt = await databaseTime(tx);
        if (receivedAt > createdAt) throw failure(400, 'INVALID_INPUT');
        const payment = await tx.payment.create({
          data: { clientId, intakeId, amount, currency, method, receivedAt, createdAt, reference, evidence, recordedById: access.userId },
          select: { id: true },
        }).catch(error => {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
            && Array.isArray(error.meta?.target) && error.meta.target.includes('intake_id')) {
            throw failure(409, 'PAYMENT_INTAKE_EXISTS');
          }
          throw error;
        });
        // The unique intake check can wait on a concurrent recording for another Client.
        await this.sessions.authorize(tx, access, [action]);
        await audit(tx, {
          actorId: access.userId, requestId, targetId: payment.id, action: AuditAction.PAYMENT_RECORDED,
          targetType: AuditTarget.PAYMENT,
        });
        return { status: 201, reference: payment.id };
      },
    });
    return { paymentId: outcome.reference!, status: PaymentStatus.UNVERIFIED };
  }
}
