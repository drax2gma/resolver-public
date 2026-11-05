import { beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { createDb } from '../src/lib/server/db';
import { loadTicketFiles } from '../src/lib/server/data';
import { getProvider, predictText } from '../src/lib/server/predict';
import { submitFeedback } from '../src/lib/server/feedback';
import { getSolverByName } from '../src/lib/server/repo';

process.env.MODEL_PROVIDER = 'fake';

let db: DatabaseSync;

beforeAll(() => {
  db = createDb(':memory:');
});

describe('SPA pipeline', () => {
  it('predicts a ticket and returns a shortlist + explanation data', async () => {
    const ticket = loadTicketFiles().find((item) => item.externalId === 'DEMO-001');
    expect(ticket).toBeTruthy();
    const result = await predictText(db, ticket!);
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.output.primary).toBeTruthy();
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.topics.length).toBeGreaterThan(0);
    expect(result.rules.length).toBeGreaterThan(0);
  });

  it('records anonymous feedback and updates topic stats', async () => {
    const ticket = loadTicketFiles().find((item) => item.externalId === 'DEMO-001')!;
    const result = await predictText(db, ticket);
    const primary = result.output.primary;
    const suggested = getSolverByName('Katona Márta')!;
    expect(suggested.id).not.toBe(primary);

    const before = db
      .prepare('SELECT COUNT(*) AS c FROM examples WHERE source = ?')
      .get('anonymous') as { c: number };
    submitFeedback(db, {
      ticketText: ticket.rawText,
      primaryId: primary,
      verdict: 'down',
      suggestedSolverId: suggested.id,
      comment: 'Ez Windows cluster hiba, nem monitoring.'
    });
    const after = db
      .prepare('SELECT COUNT(*) AS c FROM examples WHERE source = ?')
      .get('anonymous') as { c: number };
    expect(after.c).toBe(before.c + 1);

    const stat = db
      .prepare('SELECT up FROM topic_stats WHERE solver_id = ? AND topic_id = ?')
      .get(suggested.id, 'windows_server') as { up: number } | undefined;
    expect(stat?.up ?? 0).toBeGreaterThan(0);
  });

  it('enforces strict feedback rules', () => {
    const ticket = loadTicketFiles().find((item) => item.externalId === 'DEMO-002')!;
    const primary = getSolverByName('Varga Tamás')!;

    expect(() =>
      submitFeedback(db, {
        ticketText: ticket.rawText,
        primaryId: primary.id,
        verdict: 'down'
      })
    ).toThrow(/kellett volna/);

    expect(() =>
      submitFeedback(db, {
        ticketText: ticket.rawText,
        primaryId: primary.id,
        verdict: 'down',
        suggestedSolverId: getSolverByName('Papp Ilona')!.id
      })
    ).toThrow(/indokl/);

    expect(() =>
      submitFeedback(db, {
        ticketText: ticket.rawText,
        primaryId: primary.id,
        verdict: 'down',
        suggestedSolverId: primary.id,
        comment: 'önmagát javasolja'
      })
    ).toThrow(/nem lehet ugyanaz/);
  });

  it('has a working provider health check', async () => {
    const health = await getProvider().health();
    expect(health.ok).toBe(true);
  });
});
