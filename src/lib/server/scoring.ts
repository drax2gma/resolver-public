import type { DatabaseSync } from 'node:sqlite';
import type { Candidate, Solver } from '../types';
import { extractTopics } from './topics';
import { includesNormalized, tokens } from './text';

export interface TopicStat {
  up: number;
  down: number;
}

export function beta(up: number, down: number): number {
  return (up + 2) / (up + down + 3);
}

export function getTopicStats(db: DatabaseSync): Map<string, TopicStat> {
  const rows = db.prepare('SELECT solver_id, topic_id, up, down FROM topic_stats').all() as Array<{
    solver_id: string;
    topic_id: string;
    up: number;
    down: number;
  }>;
  const map = new Map<string, TopicStat>();
  for (const row of rows) map.set(`${row.solver_id}:${row.topic_id}`, { up: row.up, down: row.down });
  return map;
}

function statFor(stats: Map<string, TopicStat>, solverId: string, topicId: string): TopicStat {
  return stats.get(`${solverId}:${topicId}`) ?? { up: 0, down: 0 };
}

export interface RankedCandidates {
  topics: string[];
  candidates: Candidate[];
}

export function rankCandidates(
  db: DatabaseSync,
  ticketText: string,
  solvers: Solver[],
  limit = 5
): RankedCandidates {
  const topics = extractTopics(ticketText);
  const stats = getTopicStats(db);
  const ticketTokens = tokens(ticketText);

  const scored: Candidate[] = solvers.map((solver) => {
    let overlap = 0;
    let affinitySum = 0;
    for (const topic of topics) {
      if (solver.topicIds.includes(topic)) overlap += 1;
      affinitySum += beta(
        statFor(stats, solver.id, topic).up,
        statFor(stats, solver.id, topic).down
      );
    }
    const topicOverlap = topics.length > 0 ? overlap / topics.length : 0;
    const affinity = topics.length > 0 ? affinitySum / topics.length : 0.5;

    let keywordHits = 0;
    for (const topic of solver.temakorok) {
      if (includesNormalized(ticketText, topic)) keywordHits += 1;
    }
    // A témakör-nevek mellett a kanonikus topic-ID egyezés is számít.
    for (const topicId of solver.topicIds) {
      if (topics.includes(topicId)) keywordHits += 0.5;
    }
    const solverTokens = tokens(
      [...solver.temakorok, solver.szerep, ...solver.szervezetek].join(' ')
    );
    let tokenHits = 0;
    for (const token of solverTokens) if (ticketTokens.has(token)) tokenHits += 1;
    const tokenNorm = Math.min(1, tokenHits / 5);
    const keywordNorm = Math.min(1, keywordHits / 3);
    const retrievalScore =
      0.45 * topicOverlap + 0.25 * keywordNorm + 0.2 * tokenNorm + 0.1 * affinity;

    return {
      id: solver.id,
      nev: solver.nev,
      szervezet: solver.szervezet,
      szervezetek: solver.szervezetek,
      szerep: solver.szerep,
      topicIds: solver.topicIds,
      temakorok: solver.temakorok,
      retrievalScore,
      affinity,
      topicOverlap,
      keywordHits,
      isSubstitute: false
    };
  });

  scored.sort(
    (a, b) => b.retrievalScore - a.retrievalScore || a.topicIds.length - b.topicIds.length
  );
  const selected = scored.slice(0, limit);

  // A helyetteseket is bevesszük a jelöltek közé, ha az elsődleges jelölt mellett vannak.
  const byId = new Map(solvers.map((s) => [s.id, s]));
  for (const candidate of [...selected]) {
    const solver = byId.get(candidate.id);
    if (!solver?.helyettesId) continue;
    if (selected.some((c) => c.id === solver.helyettesId)) continue;
    const substitute = byId.get(solver.helyettesId);
    if (!substitute) continue;
    const existing = scored.find((c) => c.id === substitute.id);
    if (existing && selected.length < limit + 1) {
      existing.isSubstitute = true;
      selected.push(existing);
    }
  }

  // A helyettesek ne szorítsák ki az első öt valódi találatot, de látszódjanak.
  return { topics, candidates: selected.slice(0, limit + 1) };
}
