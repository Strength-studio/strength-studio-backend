import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { Database } from './database';
import { failure, Public } from './http';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly db: Database) {}

  @Get() @Public() @SkipThrottle()
  liveness() {
    return { status: 'ok' };
  }

  @Get('ready') @Public() @SkipThrottle()
  async readiness() {
    try {
      await this.db.command(tx => tx.$queryRaw`SELECT 1`);
      return { status: 'ready' };
    } catch {
      throw failure(503, 'DATABASE_UNAVAILABLE');
    }
  }
}
