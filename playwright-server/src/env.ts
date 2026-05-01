/**
 * Environment loader — MUST be the first import in server.ts.
 * Loads .env from both local (playwright-server/) and parent (monorepo root)
 * directories, ensuring env vars are available before any other module
 * evaluates its module-level `process.env` reads.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envLocal = path.join(__dirname, '..', '.env');
const envRoot = path.join(__dirname, '..', '..', '.env');

// Load local first, then root — root values don't override local ones
dotenv.config({ path: envLocal });
dotenv.config({ path: envRoot });
