import { Injectable } from '@nestjs/common';
import { AuditAction, AuditTarget, PaymentStatus, Prisma, Role } from '@prisma/client';
import { AccessContext, Sessions } from '../identity/session.service';
import { audit } from '../platform/audit';
import { Commands } from '../platform/commands';
import { databaseTime } from '../platform/database';
import { failure } from '../platform/http';
import { AllocatePaymentDto, PaymentAllocationDto, RecordPaymentDto } from './payment.dto';

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

  async verify(access: AccessContext, requestId: string, key: string | undefined, id: string) {
    const paymentId = id.toLowerCase();
    const action = 'payment.verify';
    const outcome = await this.commands.run({
      access, action, key, args: [paymentId],
      write: async tx => {
        const [payment] = await tx.$queryRaw<{ status: PaymentStatus }[]>`
          SELECT status FROM payment WHERE id = ${paymentId}::uuid FOR UPDATE`;
        // Recheck authorization after waiting for a competing verification.
        await this.sessions.authorize(tx, access, [action]);
        if (!payment) throw failure(404, 'PAYMENT_NOT_FOUND');
        if (payment.status !== PaymentStatus.UNVERIFIED) throw failure(409, 'PAYMENT_NOT_UNVERIFIED');
        const verifiedAt = await databaseTime(tx);
        await tx.payment.update({
          where: { id: paymentId },
          data: { status: PaymentStatus.VERIFIED, verifiedById: access.userId, verifiedAt },
          select: { id: true },
        });
        await audit(tx, {
          actorId: access.userId, requestId, targetId: paymentId, action: AuditAction.PAYMENT_VERIFIED,
          targetType: AuditTarget.PAYMENT,
        });
        return { status: 200, reference: paymentId };
      },
    });
    return { paymentId: outcome.reference!, status: PaymentStatus.VERIFIED };
  }

  async allocate(access: AccessContext, requestId: string, key: string | undefined, id: string,
    dto: AllocatePaymentDto): Promise<PaymentAllocationDto> {
    const paymentId = id.toLowerCase();
    const purchaseId = dto.purchaseId.toLowerCase();
    const requestedAmount = new Prisma.Decimal(dto.amount);
    if (!requestedAmount.gt(0)) throw failure(400, 'INVALID_INPUT');
    const amount = requestedAmount.toFixed(2);
    const action = 'payment.allocate';
    const outcome = await this.commands.run({
      access, action, key, args: [paymentId, purchaseId, amount],
      write: async tx => {
        // The insert trigger locks the payment and checks eligibility and remaining funds.
        const [allocation] = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO payment_allocation (payment_id, purchase_id, amount, allocated_by)
          VALUES (${paymentId}::uuid, ${purchaseId}::uuid, ${requestedAmount}, ${access.userId}::uuid)
          RETURNING id`.catch(error => {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2010') {
            switch (error.meta?.code) {
              case 'SS001': throw failure(404, 'PAYMENT_NOT_FOUND');
              case 'SS002': throw failure(404, 'PURCHASE_NOT_FOUND');
              case 'SS003': throw failure(409, 'PAYMENT_NOT_VERIFIED');
              case 'SS004': throw failure(409, 'PAYMENT_PURCHASE_CLIENT_MISMATCH');
              case 'SS005': throw failure(409, 'PAYMENT_ALLOCATION_EXCEEDS_AVAILABLE');
            }
          }
          throw error;
        });
        await this.sessions.authorize(tx, access, [action]);
        await audit(tx, {
          actorId: access.userId, requestId, targetId: allocation.id, action: AuditAction.PAYMENT_ALLOCATED,
          targetType: AuditTarget.PAYMENT_ALLOCATION, redactedDetails: { paymentId, purchaseId },
        });
        return { status: 201, reference: allocation.id };
      },
    });
    return { allocationId: outcome.reference!, paymentId, purchaseId, amount, currency: 'SAR' };
  }
}
