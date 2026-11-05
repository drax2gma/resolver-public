import type { Candidate, PredictionOutput, Rule, SimilarExample, TicketInput } from '../../types';

export interface PredictionInput {
  ticket: TicketInput;
  candidates: Candidate[];
  examples: SimilarExample[];
  rules: Rule[];
  topics: string[];
}

export interface ModelProvider {
  name: string;
  model: string;
  predict(input: PredictionInput): Promise<PredictionOutput>;
  health(): Promise<{ ok: boolean; detail: string }>;
}
