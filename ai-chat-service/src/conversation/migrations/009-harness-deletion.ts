import type { DatabaseSync } from 'node:sqlite';

export function up(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS deletion_jobs (
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      phase TEXT NOT NULL CHECK(phase IN ('tombstoned', 'stopped', 'flushed', 'purged', 'completed')),
      expected_revision TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      PRIMARY KEY (resource_type, resource_id)
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS deleted_resources (
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      deleted_at TEXT NOT NULL,
      PRIMARY KEY (resource_type, resource_id)
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS harness_attachments (
      content_hash TEXT PRIMARY KEY,
      ref_count INTEGER NOT NULL CHECK(ref_count >= 0),
      size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
      created_at TEXT NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS harness_attachment_refs (
      session_id TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      ref_count INTEGER NOT NULL CHECK(ref_count >= 0),
      released_at TEXT,
      PRIMARY KEY (session_id, content_hash),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_deletion_jobs_phase ON deletion_jobs(resource_type, phase, updated_at)'
  );
}

export function down(db: DatabaseSync): void {
  db.exec('DROP TABLE IF EXISTS harness_attachment_refs');
  db.exec('DROP TABLE IF EXISTS harness_attachments');
  db.exec('DROP TABLE IF EXISTS deleted_resources');
  db.exec('DROP TABLE IF EXISTS deletion_jobs');
}
