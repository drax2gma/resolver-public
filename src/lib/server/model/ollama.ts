import { z } from 'zod';
import type { PredictionOutput } from '../../types';
import { buildPrompt } from './prompt';
import type { ModelProvider, PredictionInput } from './provider';

const outputSchema = z.object({
  primary: z.string(),
  alternatives: z.array(z.string()).default([]),
  additional_solver_ids: z.array(z.string()).default([]),
  confidence: z.coerce.number().min(0).max(1).default(0.5),
  rationale: z.string().default(''),
  topics: z.array(z.string()).default([]),
  missing_info: z.array(z.string()).default([])
});

function stripFences(content: string): string {
  const trimmed = content.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed.replace(/^```[a-zA-Z]*\s*/, '').replace(/```$/, '').trim();
}

function parseOutput(content: string): PredictionOutput {
  const raw = JSON.parse(stripFences(content)) as unknown;
  const parsed = outputSchema.parse(raw);
  return {
    primary: parsed.primary,
    alternatives: parsed.alternatives,
    additional_solver_ids: parsed.additional_solver_ids,
    confidence: parsed.confidence,
    rationale: parsed.rationale,
    topics: parsed.topics,
    missing_info: parsed.missing_info
  };
}

export class OllamaProvider implements ModelProvider {
  name = 'ollama';
  model: string;
  private url: string;
  private timeoutMs: number;
  private numCtx: number;
  private numPredict: number;
  private numThread: number;

  constructor(options?: {
    url?: string;
    model?: string;
    timeoutMs?: number;
    numCtx?: number;
    numPredict?: number;
    numThread?: number;
  }) {
    this.url = options?.url ?? process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
    this.model = options?.model ?? process.env.OLLAMA_MODEL ?? 'qwen3.5:2b';
    this.timeoutMs = options?.timeoutMs ?? Number(process.env.MODEL_TIMEOUT_MS ?? 90_000);
    this.numCtx = options?.numCtx ?? Number(process.env.MODEL_NUM_CTX ?? 4096);
    this.numPredict = options?.numPredict ?? Number(process.env.MODEL_NUM_PREDICT ?? 120);
    this.numThread = options?.numThread ?? Number(process.env.OLLAMA_NUM_THREAD ?? 0);
  }

  private async chat(system: string, user: string): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      stream: false,
      format: 'json',
      think: false,
      keep_alive: '30m',
      options: {
        temperature: 0,
        num_ctx: this.numCtx,
        num_predict: this.numPredict,
        top_k: 1,
        ...(this.numThread > 0 ? { num_thread: this.numThread } : {})
      }
    };

    const response = await fetch(`${this.url}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Ollama HTTP ${response.status}: ${text.slice(0, 300)}`);
    }
    const data = (await response.json()) as { message?: { content?: string }; error?: string };
    if (data.error) throw new Error(`Ollama: ${data.error}`);
    const content = data.message?.content;
    if (!content) throw new Error('Ollama: üres válasz');
    return content;
  }

  async predict(input: PredictionInput): Promise<PredictionOutput> {
    const { system, user } = buildPrompt(
      input.ticket,
      input.candidates,
      input.examples,
      input.rules,
      input.topics
    );

    const first = await this.chat(system, user);
    try {
      return parseOutput(first);
    } catch (error) {
      const repair = `${user}\n\nA korábbi válaszod nem volt érvényes JSON a sémában. Csak a JSON-t add vissza, semmi mást.`;
      const second = await this.chat(system, repair);
      try {
        return parseOutput(second);
      } catch (secondError) {
        throw new Error(
          `Érvénytelen modellválasz: ${(secondError as Error).message}; első hiba: ${(error as Error).message}`
        );
      }
    }
  }

  async health(): Promise<{ ok: boolean; detail: string }> {
    try {
      const response = await fetch(`${this.url}/api/tags`, {
        signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) return { ok: false, detail: `HTTP ${response.status}` };
      const data = (await response.json()) as { models?: Array<{ name: string }> };
      const names = (data.models ?? []).map((m) => m.name);
      const found = names.some((name) => name === this.model || name.startsWith(`${this.model}:`));
      return {
        ok: found,
        detail: found
          ? `modell elérhető: ${this.model}`
          : `modell nincs betöltve (${this.model}); elérhető: ${names.slice(0, 5).join(', ') || 'nincs'}`
      };
    } catch (error) {
      return { ok: false, detail: (error as Error).message };
    }
  }
}
