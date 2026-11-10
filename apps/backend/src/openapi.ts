import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createApp } from './app';

async function generate() {
  // Construct controller metadata without connecting to a database.
  const app = await createApp({ databaseUrl: 'postgresql://127.0.0.1/unused', signingKey: Buffer.alloc(32),
    host: '127.0.0.1', port: 3000, socketRecheckMs: 15_000 });
  try {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Strength Studio API')
      .setVersion('1').setDescription('Strength Studio Foundation and public catalog').addBearerAuth().build());
    await writeFile(resolve(__dirname, '../../../packages/api-contract/openapi.json'), JSON.stringify(document, null, 2) + '\n');
  } finally {
    await app.close();
  }
}

void generate().catch(() => { process.stderr.write('OpenAPI generation failed\n'); process.exitCode = 1; });
