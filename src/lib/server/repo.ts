import type { DatabaseSync } from 'node:sqlite';
import type { Rule, Solver } from '../types';
import { buildSolvers, loadRouterConfig, loadRules } from './data';

let solverCache: Solver[] | null = null;
let ruleCache: Rule[] | null = null;

export function getSolvers(): Solver[] {
  if (!solverCache) solverCache = buildSolvers();
  return solverCache;
}

export function getSolverById(id: string): Solver | null {
  return getSolvers().find((solver) => solver.id === id) ?? null;
}

export function getSolverByName(name: string): Solver | null {
  return getSolvers().find((solver) => solver.nev === name) ?? null;
}

export function getOrgs(): string[] {
  return [...loadRouterConfig().szervezetek].sort((a, b) => a.localeCompare(b, 'hu'));
}

export function getRules(): Rule[] {
  if (!ruleCache) ruleCache = loadRules();
  return ruleCache;
}

/** YAML szerkesztés után hívd, hogy a következő kérés friss adatot lásson. */
export function invalidateRouterCache(): void {
  solverCache = null;
  ruleCache = null;
}

export interface ExampleRow {
  id: string;
  text: string;
  topic_ids_json: string;
  solver_id: string;
  verdict: 'up' | 'down';
  suggested_solver_id: string | null;
  suggested_org: string | null;
  comment: string | null;
  source: 'anonymous' | 'seed';
  created_at: string;
}

export function getExamples(db: DatabaseSync, limit = 200): ExampleRow[] {
  return db
    .prepare('SELECT * FROM examples ORDER BY created_at DESC LIMIT ?')
    .all(limit) as unknown as ExampleRow[];
}

export function getExampleCount(db: DatabaseSync): number {
  return (db.prepare('SELECT COUNT(*) AS c FROM examples').get() as { c: number }).c;
}
