import { startApp } from './app';
import { loadConfig } from './platform/config';

async function main() {
  const config = loadConfig();
  await startApp(config);
  process.stdout.write(JSON.stringify({ event: 'api_started', host: config.host, port: config.port }) + '\n');
}

void main().catch(() => {
  process.stderr.write('API startup failed. Check the environment and listen address.\n');
  process.exitCode = 1;
});
