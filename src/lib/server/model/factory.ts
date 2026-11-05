import { FakeProvider } from './fake';
import { OllamaProvider } from './ollama';
import type { ModelProvider } from './provider';

export function getProvider(): ModelProvider {
  const kind = (process.env.MODEL_PROVIDER ?? 'fake').toLowerCase();
  if (kind === 'ollama') return new OllamaProvider();
  return new FakeProvider();
}
