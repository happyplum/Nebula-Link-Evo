import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, unlinkSync } from 'node:fs';
import { beforeAll, afterAll } from 'vitest';

const tempDbFiles: string[] = [];

export function setupDatabase(): string {
  const isIntegration = process.env.TEST_TYPE === 'integration';
  const dbPath = isIntegration ? generateTempDbPath() : ':memory:';

  if (isIntegration) {
    tempDbFiles.push(dbPath);
  }

  process.env.TEST_DB_PATH = dbPath;
  return dbPath;
}

function generateTempDbPath(): string {
  return join(
    tmpdir(),
    `test-db-${Date.now()}-${process.pid}.sqlite`
  );
}

export function teardownDatabase(): void {
  tempDbFiles.forEach((filePath) => {
    try {
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    } catch (error) {
      console.error(`Failed to delete temp database: ${filePath}`, error);
    }
  });
  tempDbFiles.length = 0;
}

export function getTestDbPath(): string {
  return process.env.TEST_DB_PATH || ':memory:';
}

beforeAll(() => {
  setupDatabase();
});

afterAll(() => {
  teardownDatabase();
});
