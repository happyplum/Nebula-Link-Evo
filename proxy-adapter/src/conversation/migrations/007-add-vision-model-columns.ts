import { DatabaseSync } from 'node:sqlite';

export function up(db: DatabaseSync): void {
  const result = db.prepare(`SELECT COUNT(*) as count FROM pragma_table_info('sessions') WHERE name = ?`);

  const visionProviderExists = (result.get('vision_provider') as { count: number }).count > 0;
  if (!visionProviderExists) {
    db.exec(`ALTER TABLE sessions ADD COLUMN vision_provider TEXT`);
  }

  const visionModelExists = (result.get('vision_model') as { count: number }).count > 0;
  if (!visionModelExists) {
    db.exec(`ALTER TABLE sessions ADD COLUMN vision_model TEXT`);
  }
}

export function down(db: DatabaseSync): void {
  db.exec(`ALTER TABLE sessions DROP COLUMN vision_provider`);
  db.exec(`ALTER TABLE sessions DROP COLUMN vision_model`);
}
