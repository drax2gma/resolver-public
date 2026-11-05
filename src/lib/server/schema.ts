export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS examples (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  topic_ids_json TEXT NOT NULL DEFAULT '[]',
  solver_id TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('up', 'down')),
  suggested_solver_id TEXT,
  suggested_org TEXT,
  comment TEXT,
  source TEXT NOT NULL DEFAULT 'anonymous' CHECK (source IN ('anonymous', 'seed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS topic_stats (
  solver_id TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  up REAL NOT NULL DEFAULT 0,
  down REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (solver_id, topic_id)
);

CREATE INDEX IF NOT EXISTS idx_examples_created ON examples(created_at);
CREATE INDEX IF NOT EXISTS idx_examples_solver ON examples(solver_id, verdict);
`;
