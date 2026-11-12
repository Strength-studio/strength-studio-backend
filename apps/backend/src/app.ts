import 'reflect-metadata';
import { Module, ValidationPipe } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { json } from 'express';
import helmet from 'helmet';
import { CatalogController } from './catalog/catalog.controller';
import { CatalogService } from './catalog/catalog.service';
import { ClientController } from './clients/client.controller';
import { ClientService } from './clients/client.service';
import { AccountsController, AuthController, DeferredController } from './identity/identity.controller';
import { AccessEvents } from './identity/access-events';
import { AccessGuard } from './identity/access.guard';
import { Realtime } from './identity/realtime';
import { Sessions } from './identity/session.service';
import { Commands } from './platform/commands';
import { CONFIG, Config } from './platform/config';
import { Database } from './platform/database';
import { HealthController } from './platform/health.controller';
import { ErrorFilter, requestContext } from './platform/http';
import { ComplimentaryController } from './purchases/complimentary.controller';
import { PositivePriceController } from './purchases/positive-price.controller';
import { PurchaseAcceptanceService } from './purchases/purchase-acceptance.service';
import { StudioController } from './studio/studio.controller';

@Module({})
class AppModule {}

export async function createApp(config: Config) {
  const app = await NestFactory.create<NestExpressApplication>({
    module: AppModule,
    imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }])],
    controllers: [HealthController, AuthController, AccountsController, StudioController, DeferredController, CatalogController,
      ClientController, ComplimentaryController, PositivePriceController],
    providers: [
      { provide: CONFIG, useValue: config },
      Database, Sessions, AccessEvents, Commands, Realtime, CatalogService, ClientService, PurchaseAcceptanceService,
      { provide: APP_GUARD, useClass: ThrottlerGuard },
      { provide: APP_GUARD, useClass: AccessGuard },
    ],
  }, { logger: false, bodyParser: false, abortOnError: false });
  app.setGlobalPrefix('api/v1');
  app.use(requestContext);
  app.use(helmet());
  app.use(json({ limit: '16kb' }));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new ErrorFilter());
  return app;
}

export async function startApp(config: Config) {
  const app = await createApp(config);
  const server = app.getHttpServer();
  server.headersTimeout = 8000;
  server.requestTimeout = 15_000;
  app.get(Realtime).attach(server);
  app.enableShutdownHooks();
  await app.listen(config.port, config.host);
  return app;
}
