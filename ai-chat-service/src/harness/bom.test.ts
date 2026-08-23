import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { verifyHarnessBom } from './bom.js';

describe('Harness BOM', () => {
  it(
    'matches the installed exact peer closure, native build and patches',
    async () => {
      const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
      await expect(verifyHarnessBom(packageRoot)).resolves.toBeUndefined();
    },
    30_000
  );
});
