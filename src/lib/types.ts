export interface Solver {
  id: string;
  nev: string;
  szervezet: string;
  szervezetek: string[];
  szerep: string;
  helyettesNev: string | null;
  helyettesId: string | null;
  temakorok: string[];
  topicIds: string[];
  profileText: string;
}

export interface TicketInput {
  externalId: string;
  targy: string;
  leiras: string;
  kategoria: string | null;
  prioritas: string | null;
  bejelento: string | null;
  erintett: string | null;
  rawText: string;
}

export interface Candidate {
  id: string;
  nev: string;
  szervezet: string;
  szervezetek: string[];
  szerep: string;
  topicIds: string[];
  temakorok: string[];
  retrievalScore: number;
  affinity: number;
  topicOverlap: number;
  keywordHits: number;
  isSubstitute: boolean;
}

export interface SimilarExample {
  id: string;
  text: string;
  solverId: string;
  solverNev: string;
  verdict: 'up' | 'down';
  suggestedSolverId: string | null;
  suggestedSolverNev: string | null;
  comment: string | null;
  similarity: number;
}

export interface Rule {
  text: string;
  keywords: string[];
}

export interface PredictionOutput {
  primary: string;
  alternatives: string[];
  additional_solver_ids: string[];
  confidence: number;
  rationale: string;
  topics: string[];
  missing_info: string[];
}

export interface PredictionResult {
  input: TicketInput;
  provider: string;
  model: string;
  candidates: Candidate[];
  output: PredictionOutput;
  confidence: number;
  latencyMs: number;
  topics: string[];
  rules: Rule[];
  examples: SimilarExample[];
}

export interface PublicSolver {
  id: string;
  nev: string;
  szervezet: string;
  szerep: string;
}

export interface WhyTopic {
  id: string;
  label: string;
}

export interface WhyExample {
  text: string;
  verdict: 'up' | 'down';
  solver: string;
  suggested: string | null;
  similarity: number;
}

export interface RecommendationResponse {
  ticket: TicketInput;
  primary: PublicSolver;
  alternatives: PublicSolver[];
  confidence: number;
  why: {
    topics: WhyTopic[];
    solverTopics: string[];
    rules: string[];
    examples: WhyExample[];
    model: string;
  };
  model: string;
  latencyMs: number;
}

export interface RouterCounts {
  solvers: number;
  topics: number;
  rules: number;
}

export interface RouterSource {
  content: string;
  hash: string;
  lines: number;
}

export interface RouterSourceSaveResponse {
  ok: true;
  hash: string;
  warnings: string[];
}

export interface RouterResponse {
  solvers: PublicSolver[];
  orgs: string[];
  counts: RouterCounts;
  source: RouterSource;
}

export interface TicketListResponse {
  tickets: TicketInput[];
}

export interface FeedbackRequest {
  ticketText: string;
  primaryId: string;
  verdict: 'up' | 'down';
  suggestedSolverId?: string | null;
  suggestedOrg?: string | null;
  comment?: string | null;
}
