import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyHarnessBom } from './bom.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
await verifyHarnessBom(packageRoot);
process.stdout.write('Harness BOM verified\n');
