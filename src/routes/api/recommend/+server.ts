import { error, json } from '@sveltejs/kit';
import { parseTicketText } from '#lib/parse-ticket';
import { getDb } from '#lib/server/db';
import { predictText } from '#lib/server/predict';
import { getSolverById } from '#lib/server/repo';
import { topicLabel } from '#lib/server/topics';
import type { PublicSolver, RecommendationResponse } from '#lib/types';
import type { RequestHandler } from './$types';

function toPublic(id: string): PublicSolver | null {
  const solver = getSolverById(id);
  if (!solver) return null;
  return {
    id: solver.id,
    nev: solver.nev,
    szervezet: solver.szervezet,
    szerep: solver.szerep
  };
}

export const POST: RequestHandler = async ({ request }) => {
  let body: { text?: unknown; filename?: unknown };
  try {
    body = (await request.json()) as { text?: unknown; filename?: unknown };
  } catch {
    throw error(400, 'Érvénytelen kérés');
  }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) throw error(400, 'Üres jegy');
  if (text.length > 50_000) throw error(413, 'Túl hosszú jegy');

  const input = parseTicketText(
    text,
    typeof body.filename === 'string' ? body.filename : undefined
  );
  const db = getDb();

  let result;
  try {
    result = await predictText(db, input);
  } catch (err) {
    throw error(502, (err as Error).message);
  }

  const primary = toPublic(result.output.primary);
  if (!primary) throw error(502, 'A modell ismeretlen megoldót adott');

  const alternatives = result.output.alternatives
    .map(toPublic)
    .filter((solver): solver is PublicSolver => solver !== null && solver.id !== primary.id);

  const primaryCandidate = result.candidates.find((candidate) => candidate.id === primary.id);

  const response: RecommendationResponse = {
    ticket: input,
    primary,
    alternatives,
    confidence: result.confidence,
    why: {
      topics: result.topics.map((id) => ({ id, label: topicLabel(id) })),
      solverTopics: primaryCandidate?.temakorok.slice(0, 6) ?? [],
      rules: result.rules.map((rule) => rule.text),
      examples: result.examples.map((example) => ({
        text: example.text,
        verdict: example.verdict,
        solver: example.solverNev,
        suggested: example.suggestedSolverNev,
        similarity: Number(example.similarity.toFixed(2))
      })),
      model: result.output.rationale
    },
    model: result.model,
    latencyMs: result.latencyMs
  };

  return json(response);
};
