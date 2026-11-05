import type { DatabaseSync } from 'node:sqlite';
import type {
  Candidate,
  PredictionOutput,
  PredictionResult,
  SimilarExample,
  Solver,
  TicketInput
} from '../types';
import { getProvider as createProvider } from './model/factory';
import { getExamples, getRules, getSolvers, getSolverById } from './repo';
import { rankCandidates } from './scoring';
import { getTopics } from './topics';
import { includesNormalized, jaccard, normalizeHu } from './text';
import { ticketText } from './data';
import type { ModelProvider } from './model/provider';

export function getProvider(): ModelProvider {
  return createProvider();
}

export function getSimilarExamples(
  db: DatabaseSync,
  text: string,
  limit = 2
): SimilarExample[] {
  const rows = getExamples(db, 200);
  const scored: SimilarExample[] = rows
    .map((row) => ({
      id: row.id,
      text: row.text,
      solverId: row.solver_id,
      solverNev: getSolverById(row.solver_id)?.nev ?? row.solver_id,
      verdict: row.verdict,
      suggestedSolverId: row.suggested_solver_id,
      suggestedSolverNev: row.suggested_solver_id
        ? (getSolverById(row.suggested_solver_id)?.nev ?? row.suggested_solver_id)
        : null,
      comment: row.comment,
      similarity: jaccard(text, row.text)
    }))
    .filter((example) => example.similarity > 0.02)
    .sort((a, b) => b.similarity - a.similarity);

  const positives = scored.filter((e) => e.verdict === 'up').slice(0, Math.ceil(limit / 2));
  const negatives = scored.filter((e) => e.verdict === 'down').slice(0, Math.floor(limit / 2));
  return [...positives, ...negatives];
}

function resolveCandidateId(value: string, candidates: Candidate[]): string | null {
  const normalized = normalizeHu(value);
  for (const candidate of candidates) {
    if (candidate.id === value || normalizeHu(candidate.nev) === normalized) return candidate.id;
  }
  return null;
}

function resolveAnySolverId(value: string, solvers: Solver[]): string | null {
  const normalized = normalizeHu(value);
  for (const solver of solvers) {
    if (solver.id === value || normalizeHu(solver.nev) === normalized) return solver.id;
  }
  return null;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function normalizeOutput(
  output: PredictionOutput,
  candidates: Candidate[],
  solvers: Solver[],
  inputTopics: string[]
): PredictionOutput {
  let primary = resolveCandidateId(output.primary, candidates) ?? candidates[0]?.id;
  if (!primary) throw new Error('A modell nem adott érvényes elsődleges megoldót');
  const modelPrimary = primary;

  // Specialista-prior: ha a modell nem specialista jelöltet választott, de van
  // legalább ugyanolyan erős retrieval-ű specialista, azt részesítjük előnyben.
  const isSpecialist = (candidate: Candidate): boolean =>
    candidate.topicOverlap > 0 && candidate.topicIds.length <= 3;
  const primaryCandidate = candidates.find((candidate) => candidate.id === primary);
  const bestSpecialist = candidates
    .filter(isSpecialist)
    .sort((a, b) => b.retrievalScore - a.retrievalScore)[0];
  let priorAdjusted = false;
  if (
    bestSpecialist &&
    primaryCandidate &&
    !isSpecialist(primaryCandidate) &&
    bestSpecialist.id !== primary &&
    bestSpecialist.retrievalScore >= primaryCandidate.retrievalScore - 0.01
  ) {
    primary = bestSpecialist.id;
    priorAdjusted = true;
  }

  const alternatives = unique([
    ...(priorAdjusted ? [modelPrimary] : []),
    ...output.alternatives
      .map((value) => resolveCandidateId(value, candidates))
      .filter((value): value is string => Boolean(value))
  ])
    .filter((id) => id !== primary)
    .slice(0, 3);

  const additional = unique(
    output.additional_solver_ids
      .map((value) => resolveAnySolverId(value, solvers))
      .filter((value): value is string => Boolean(value))
  )
    .filter((id) => id !== primary && !alternatives.includes(id))
    .slice(0, 3);

  const knownTopics = new Set(getTopics().map((topic) => topic.id));
  const topics = unique(output.topics.filter((topic) => knownTopics.has(topic)));
  const missing = unique(output.missing_info.map((item) => item.trim()).filter(Boolean)).slice(0, 5);

  const finalPrimaryCandidate = candidates.find((candidate) => candidate.id === primary);
  const fallbackAlternatives = candidates
    .filter((candidate) => candidate.id !== primary)
    .slice(0, 2)
    .map((candidate) => candidate.id);

  return {
    primary,
    alternatives: alternatives.length ? alternatives : fallbackAlternatives,
    additional_solver_ids: additional,
    confidence: Math.max(0, Math.min(1, output.confidence * (priorAdjusted ? 0.9 : 1))),
    rationale: `${
      output.rationale?.trim() ||
      `A legjobb egyezés: ${finalPrimaryCandidate?.nev ?? primary} (${finalPrimaryCandidate?.szervezet ?? '—'}).`
    }${priorAdjusted ? ` Specialista-prior: ${finalPrimaryCandidate?.nev ?? primary}.` : ''}`,
    topics: topics.length ? topics : inputTopics,
    missing_info: missing
  };
}

export interface PredictOptions {
  provider?: ModelProvider;
}

export async function predictText(
  db: DatabaseSync,
  input: TicketInput,
  options: PredictOptions = {}
): Promise<PredictionResult> {
  const solvers = getSolvers();
  const text = ticketText(input);
  const ranked = rankCandidates(db, text, solvers);
  if (ranked.candidates.length === 0) throw new Error('Nincs aktív megoldó a predikcióhoz');

  const examples = getSimilarExamples(db, text, 2);
  const rules = getRules().filter(
    (rule) =>
      rule.keywords.length === 0 ||
      rule.keywords.some((keyword) => includesNormalized(text, keyword))
  );
  const provider = options.provider ?? getProvider();
  const started = Date.now();
  const raw = await provider.predict({
    ticket: input,
    candidates: ranked.candidates,
    examples,
    rules,
    topics: ranked.topics
  });
  const output = normalizeOutput(raw, ranked.candidates, solvers, ranked.topics);
  const latencyMs = Date.now() - started;

  const top =
    ranked.candidates.find((candidate) => candidate.id === output.primary) ?? ranked.candidates[0];
  const confidence = Number(
    Math.max(
      0.05,
      Math.min(0.99, 0.55 * output.confidence + 0.3 * top.retrievalScore + 0.15 * top.affinity)
    ).toFixed(3)
  );

  return {
    input,
    provider: provider.name,
    model: provider.model,
    candidates: ranked.candidates,
    output,
    confidence,
    latencyMs,
    topics: ranked.topics,
    rules,
    examples
  };
}
