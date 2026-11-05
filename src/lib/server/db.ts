import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL } from './schema';

let singleton: DatabaseSync | undefined;

export function createDb(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA_SQL);
  return db;
}

export function getDb(): DatabaseSync {
  if (!singleton) singleton = createDb(process.env.DB_PATH ?? './data/resolver.db');
  return singleton;
}

export function closeDb(): void {
  if (singleton) {
    singleton.close();
    singleton = undefined;
  }
}

export function uid(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
