import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { CONFIG, Config } from './config';
import { failure } from './http';

export type Transaction = Prisma.TransactionClient;

@Injectable()
export class Database extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(CONFIG) config: Config) {
    super({ datasourceUrl: config.databaseUrl, errorFormat: 'minimal' });
  }

  onModuleDestroy() {
    return this.$disconnect();
  }

  async command<T>(run: (tx: Transaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.$transaction(async tx => {
          await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`;
          await tx.$executeRaw`SET LOCAL statement_timeout = '4s'`;
          return run(tx);
        }, { isolationLevel: 'ReadCommitted', maxWait: 3000, timeout: 8000 });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError)) throw error;
        const transient = error.code === 'P2034' || error.code === 'P2024'
          || (error.code === 'P2010' && ['40P01', '55P03', '40001', '57014'].includes(String(error.meta?.code)));
        if (!transient) throw error;
        if (attempt === 1) throw failure(503, 'RETRY_TRANSACTION');
      }
    }
  }
}

export async function databaseTime(tx: Transaction): Promise<Date> {
  const [row] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
  return row.now;
}
