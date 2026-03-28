/**
 * VF4 Contract: Scope fidelity guardrails for chat-session autonomy.
 *
 * Verifies:
 * 1. No browser execution path was introduced into chat session flow files.
 * 2. Sessions route handler does not import browser automation modules.
 * 3. Durable writes in chat session flow stay on DatabaseManager (SQLite).
 * 4. No third durable authority source exists beyond node:sqlite.
 */
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';

const readSource = async (path: string): Promise<string> => {
  return readFile(new URL(path, import.meta.url), 'utf-8');
};

const BROWSER_IMPORT_PATTERNS = [
  /from\s+['"](?:[^'"]*playwright-server[^'"]*)['"]/i,
  /from\s+['"](?:playwright|puppeteer|selenium|@playwright\/test|chromium)['"]/i,
];

const BROWSER_SYMBOL_PATTERNS = [
  /\bBrowserService\b/,
  /\bBrowserClient\b/,
  /\bplaywright\b/i,
  /\bchromium\b/i,
  /\bpuppeteer\b/i,
  /\bselenium\b/i,
];

const ALT_DURABLE_AUTHORITY_PATTERNS = [
  /from\s+['"](?:better-sqlite3|sqlite3|pg|postgres|mysql|mysql2|mongoose|mongodb|redis|ioredis|prisma|typeorm|knex|sequelize)['"]/i,
  /new\s+DatabaseSync\s*\(/,
  /createConnection\s*\(/,
  /createPool\s*\(/,
  /MongoClient\s*\./,
];

describe('VF4: Scope fidelity contract', () => {
  it('chat-handler.ts does not import browser automation packages', async () => {
    const source = await readSource('../../../conversation/chat-handler.ts');
    const importLines = source
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('import '));

    for (const pattern of BROWSER_IMPORT_PATTERNS) {
      expect(importLines.some((line) => pattern.test(line))).toBe(false);
    }

    expect(source).not.toContain('playwright-server');
  });

  it('sessions.ts route handler does not import browser-related modules', async () => {
    const source = await readSource('../../../plugins/routes/api/chat/sessions.ts');
    const importLines = source
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('import '));

    for (const pattern of BROWSER_IMPORT_PATTERNS) {
      expect(importLines.some((line) => pattern.test(line))).toBe(false);
    }

    for (const pattern of BROWSER_SYMBOL_PATTERNS) {
      expect(pattern.test(source)).toBe(false);
    }
  });

  it('chat session durable writes stay on DatabaseManager + SessionEventsDAO path', async () => {
    const sessionsSource = await readSource('../../../plugins/routes/api/chat/sessions.ts');
    const chatHandlerSource = await readSource('../../../conversation/chat-handler.ts');
    const managerSource = await readSource('../../../conversation/manager.ts');

    expect(sessionsSource).toContain("import { DatabaseManager } from '../../../../conversation/db.js';");
    expect(sessionsSource).toContain('const db = DatabaseManager.getInstance();');
    expect(sessionsSource).toContain('const sessionEventsDAO = db.getSessionEventsDAO();');
    expect(sessionsSource).toContain('await sessionEventsDAO.appendEvent(');

    expect(chatHandlerSource).toContain('DatabaseManager.getInstance().getSessionEventsDAO()');
    expect(chatHandlerSource).toContain('this.sessionEventsDAO.appendEvent(');

    expect(managerSource).toContain("import { DatabaseManager } from './db.js';");
    expect(managerSource).toContain('const msg = this.db.createMessage({');
  });

  it('no third durable authority source exists beyond SQLite via node:sqlite', async () => {
    const dbSource = await readSource('../../../conversation/db.ts');
    const sessionsSource = await readSource('../../../plugins/routes/api/chat/sessions.ts');
    const chatHandlerSource = await readSource('../../../conversation/chat-handler.ts');
    const managerSource = await readSource('../../../conversation/manager.ts');

    expect(dbSource).toContain("import { DatabaseSync } from 'node:sqlite';");

    const flowSources = [sessionsSource, chatHandlerSource, managerSource, dbSource];
    for (const source of flowSources) {
      for (const pattern of ALT_DURABLE_AUTHORITY_PATTERNS) {
        if (pattern.source === 'new\\s+DatabaseSync\\s*\\(' && source === dbSource) {
          continue;
        }
        expect(pattern.test(source)).toBe(false);
      }
    }
  });
});
