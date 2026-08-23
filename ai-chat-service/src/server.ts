import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildApp, SERVICE_VERSION } from './app.js';
import { loadConfig as loadServiceConfig } from './config/service-config.js';

loadEnvironment();

const serviceConfig = loadServiceConfig();
const app = await buildApp({ serviceConfig });

let closing = false;
async function shutdown(signal: 'SIGINT' | 'SIGTERM'): Promise<void> {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, '[ai-chat-service] shutdown');
  await app.close();
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ port: serviceConfig.port, host: serviceConfig.host });
  app.log.info(
    { version: SERVICE_VERSION, url: `http://${serviceConfig.host}:${serviceConfig.port}` },
    'ai-chat-service running'
  );
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}

function loadEnvironment(): void {
  const local = join(process.cwd(), '.env');
  const root = join(process.cwd(), '..', '.env');
  if (existsSync(local)) dotenv.config({ path: local });
  else if (existsSync(root)) dotenv.config({ path: root });
  else dotenv.config();
}
