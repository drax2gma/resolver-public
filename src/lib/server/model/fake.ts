import type { PredictionOutput } from '../../types';
import type { ModelProvider, PredictionInput } from './provider';

export class FakeProvider implements ModelProvider {
  name = 'fake';
  model = 'fake-retrieval-v1';

  async predict(input: PredictionInput): Promise<PredictionOutput> {
    const top = input.candidates[0];
    if (!top) throw new Error('Nincs jelölt a predikcióhoz');
    const alternatives = input.candidates.slice(1, 3).map((c) => c.id);
    const confidence = Math.max(0.3, Math.min(0.9, 0.35 + top.retrievalScore * 0.55));
    return {
      primary: top.id,
      alternatives,
      additional_solver_ids: [],
      confidence,
      rationale: `A legjobb témakör-egyezés: ${top.nev} (${top.szervezet}).`,
      topics: input.topics,
      missing_info: []
    };
  }

  async health(): Promise<{ ok: boolean; detail: string }> {
    return { ok: true, detail: 'fake provider (determinisztikus retrieval baseline)' };
  }
}
