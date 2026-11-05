import type { DatabaseSync } from 'node:sqlite';
import type { FeedbackRequest } from '../types';
import { transaction, uid } from './db';
import { getOrgs, getSolverById, getSolvers } from './repo';
import { extractTopics } from './topics';

export function submitFeedback(db: DatabaseSync, input: FeedbackRequest): void {
  const text = input.ticketText?.trim();
  if (!text) throw new Error('Hiányzó jegy szöveg');
  const primary = getSolverById(input.primaryId);
  if (!primary) throw new Error('Ismeretlen elsődleges megoldó');
  if (input.verdict !== 'up' && input.verdict !== 'down') throw new Error('Érvénytelen visszajelzés');

  const suggestedSolverId = input.suggestedSolverId?.trim() || null;
  const suggestedOrg = input.suggestedOrg?.trim() || null;
  const comment = input.comment?.trim() || null;

  if (input.verdict === 'down') {
    if (!suggestedSolverId && !suggestedOrg) {
      throw new Error('Nem releváns visszajelzésnél kötelező megadni, kihez kellett volna kerülnie');
    }
    if (suggestedSolverId && suggestedSolverId === primary.id) {
      throw new Error('A javasolt megoldó nem lehet ugyanaz, mint az aktuális');
    }
    if (!comment || comment.length < 5) {
      throw new Error('Nem releváns visszajelzésnél kötelező rövid indoklást írni');
    }
    if (suggestedSolverId && !getSolverById(suggestedSolverId)) {
      throw new Error('Ismeretlen javasolt megoldó');
    }
    if (suggestedOrg && !getOrgs().includes(suggestedOrg)) {
      throw new Error('Ismeretlen szervezet');
    }
  }

  const topics = extractTopics(text);
  const topicJson = JSON.stringify(topics.length ? topics : ['altalanos']);

  transaction(db, () => {
    db.prepare(
      `INSERT INTO examples
        (id, text, topic_ids_json, solver_id, verdict, suggested_solver_id, suggested_org, comment, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'anonymous')`
    ).run(
      uid(),
      text.slice(0, 4000),
      topicJson,
      primary.id,
      input.verdict,
      suggestedSolverId,
      suggestedOrg,
      comment
    );
    recomputeTopicStats(db);
  });
}

export function recomputeTopicStats(db: DatabaseSync): void {
  const solvers = getSolvers();
  const rows = db
    .prepare(
      'SELECT solver_id, verdict, suggested_solver_id, suggested_org, source, created_at, text FROM examples'
    )
    .all() as Array<{
    solver_id: string;
    verdict: 'up' | 'down';
    suggested_solver_id: string | null;
    suggested_org: string | null;
    source: 'anonymous' | 'seed';
    created_at: string;
    text: string;
  }>;

  const stats = new Map<string, { up: number; down: number }>();
  const add = (solverId: string, topicId: string, up: number, down: number) => {
    const key = `${solverId}:${topicId}`;
    const current = stats.get(key) ?? { up: 0, down: 0 };
    current.up += up;
    current.down += down;
    stats.set(key, current);
  };

  const topicsFor = (text: string): string[] => {
    const topics = extractTopics(text);
    return topics.length ? topics : ['altalanos'];
  };

  const now = Date.now();
  for (const row of rows) {
    const ageDays = Math.max(0, (now - Date.parse(row.created_at)) / 86_400_000);
    const decay = Math.exp(-ageDays / 90);
    const weight = row.source === 'seed' ? 0.5 : 1;
    const topics = topicsFor(row.text);

    for (const topic of topics) {
      if (row.verdict === 'up') add(row.solver_id, topic, decay * weight, 0);
      else add(row.solver_id, topic, 0, decay * weight);

      if (row.suggested_solver_id) {
        add(row.suggested_solver_id, topic, decay * weight, 0);
      }
      if (row.suggested_org) {
        for (const solver of solvers) {
          if (solver.szervezetek.includes(row.suggested_org)) {
            add(solver.id, topic, decay * weight * 0.3, 0);
          }
        }
      }
    }
  }

  db.prepare('DELETE FROM topic_stats').run();
  const insert = db.prepare(
    `INSERT INTO topic_stats (solver_id, topic_id, up, down, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  );
  for (const [key, value] of stats) {
    const [solverId, topicId] = key.split(':');
    insert.run(solverId, topicId, value.up, value.down, new Date().toISOString());
  }
}
