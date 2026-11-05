import { createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { ZodError } from 'zod';
import {
  buildSolvers,
  buildSolversFrom,
  invalidateConfigCache,
  parseRouterConfig
} from './data';
import { recomputeTopicStats } from './feedback';
import { invalidateRouterCache } from './repo';
import { invalidateTopicsCache } from './topics';

const SOURCE_NAME = 'router.yaml';
const MAX_SOURCE_BYTES = 512 * 1024;
const BACKUP_KEEP = 20;

export class RouterFileError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'RouterFileError';
  }
}

function baseDir(): string {
  return process.env.DATA_DIR ?? process.cwd();
}

function sourcePath(): string {
  return join(baseDir(), SOURCE_NAME);
}

function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function describeError(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues
      .map((issue) => `${issue.path.join('.') || '(gyökér)'}: ${issue.message}`)
      .join('; ');
  }
  const yamlError = error as Error & { linePos?: Array<{ line: number; col: number }> };
  const pos = yamlError.linePos?.[0];
  const where = pos ? ` (${pos.line}:${pos.col})` : '';
  return `${yamlError.message}${where}`;
}

export interface RouterSourceContent {
  content: string;
  hash: string;
}

export function readRouterSource(): RouterSourceContent {
  const content = readFileSync(sourcePath(), 'utf8');
  return { content, hash: hashContent(content) };
}

/**
 * Szerveroldali, hiteles validáció. A kliens lint csak jelzés; mentéskor ez dönt.
 */
export function validateRouterContent(content: string): void {
  if (content.trim().length === 0) {
    throw new RouterFileError(400, `${SOURCE_NAME}: üres fájl`);
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_SOURCE_BYTES) {
    throw new RouterFileError(413, `${SOURCE_NAME}: túl nagy fájl (max 512 KB)`);
  }

  try {
    buildSolversFrom(parseRouterConfig(content));
  } catch (error) {
    if (error instanceof RouterFileError) throw error;
    throw new RouterFileError(400, `${SOURCE_NAME}: ${describeError(error)}`);
  }
}

function backupFile(target: string): void {
  const backupDir = join(baseDir(), 'data', '.backups');
  mkdirSync(backupDir, { recursive: true });
  const safeName = SOURCE_NAME.replace(/[^a-z0-9._-]+/gi, '__');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  copyFileSync(target, join(backupDir, `${safeName}.${stamp}.bak`));
  const backups = readdirSync(backupDir)
    .filter((file) => file.startsWith(`${safeName}.`))
    .sort();
  for (const old of backups.slice(0, Math.max(0, backups.length - BACKUP_KEEP))) {
    unlinkSync(join(backupDir, old));
  }
}

function collectWarnings(db: DatabaseSync): string[] {
  const warnings: string[] = [];
  const solverIds = new Set(buildSolvers().map((solver) => solver.id));
  const rows = db.prepare('SELECT DISTINCT solver_id FROM examples').all() as Array<{
    solver_id: string;
  }>;
  const orphaned = rows.map((row) => row.solver_id).filter((id) => !solverIds.has(id));
  if (orphaned.length > 0) {
    warnings.push(
      `${orphaned.length} korábbi visszajelzés olyan megoldóra hivatkozik, amely már nincs a routerben: ${orphaned.join(', ')}.`
    );
  }
  return warnings;
}

export function saveRouterSource(
  db: DatabaseSync,
  content: string,
  baseHash: string
): { hash: string; warnings: string[] } {
  const target = sourcePath();
  const current = readFileSync(target, 'utf8');
  if (hashContent(current) !== baseHash) {
    throw new RouterFileError(
      409,
      `${SOURCE_NAME}: a fájl közben megváltozott. Töltsd újra, és nézd át a különbséget.`
    );
  }

  validateRouterContent(content);

  backupFile(target);
  const temp = join(dirname(target), `.${basename(target)}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(temp, content, 'utf8');
  renameSync(temp, target);

  invalidateConfigCache();
  invalidateRouterCache();
  invalidateTopicsCache();
  recomputeTopicStats(db);

  return { hash: hashContent(content), warnings: collectWarnings(db) };
}
