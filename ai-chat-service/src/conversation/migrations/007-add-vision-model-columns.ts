import { DatabaseSync } from 'node:sqlite';

function columnExists(db: DatabaseSync, columnName: string): boolean {
  const result = db.prepare("SELECT COUNT(*) as count FROM pragma_table_info('sessions') WHERE name = ?");
  const row = result.get(columnName);
  return typeof row?.count === 'number' && row.count > 0;
}

export function up(db: DatabaseSync): void {
  if (!columnExists(db, 'vision_provider')) {
    db.exec('ALTER TABLE sessions ADD COLUMN vision_provider TEXT');
  }

  if (!columnExists(db, 'vision_model')) {
    db.exec('ALTER TABLE sessions ADD COLUMN vision_model TEXT');
  }
}

export function down(db: DatabaseSync): void {
  db.exec('ALTER TABLE sessions DROP COLUMN vision_provider');
  db.exec('ALTER TABLE sessions DROP COLUMN vision_model');
}
