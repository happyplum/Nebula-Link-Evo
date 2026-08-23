import type { DatabaseSync } from 'node:sqlite';

export function up(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS harness_run_scheduler_state (
      singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
      next_queue_seq INTEGER NOT NULL CHECK(next_queue_seq > 0)
    );
    INSERT OR IGNORE INTO harness_run_scheduler_state(singleton, next_queue_seq) VALUES (1, 1);

    CREATE TABLE IF NOT EXISTS harness_model_runs (
      run_id TEXT PRIMARY KEY,
      owner_type TEXT NOT NULL CHECK(owner_type IN ('chat', 'agent_task')),
      owner_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      idempotency_key TEXT,
      status TEXT NOT NULL CHECK(status IN ('queued', 'active', 'completed', 'cancelled')),
      queue_seq INTEGER NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_harness_model_runs_status_queue
      ON harness_model_runs(status, queue_seq);
  `);
}

export function down(db: DatabaseSync): void {
  db.exec('DROP TABLE IF EXISTS harness_model_runs');
  db.exec('DROP TABLE IF EXISTS harness_run_scheduler_state');
}
