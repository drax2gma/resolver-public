import { loadTopics, type TopicDef } from './data';
import { normalizeHu } from './text';

let cache: TopicDef[] | null = null;

export function getTopics(): TopicDef[] {
  if (!cache) cache = loadTopics();
  return cache;
}

export function topicLabel(id: string): string {
  return getTopics().find((t) => t.id === id)?.nev ?? id;
}

/** router.yaml szerkesztése után hívd. */
export function invalidateTopicsCache(): void {
  cache = null;
}

export function extractTopics(text: string): string[] {
  const hay = ` ${normalizeHu(text)} `;
  const hits: string[] = [];
  for (const topic of getTopics()) {
    if (topic.id === 'egyeb') continue;
    const matched = topic.kulcsszavak.some((keyword) => {
      const needle = normalizeHu(keyword);
      return needle.length > 0 && hay.includes(` ${needle} `);
    });
    if (matched) hits.push(topic.id);
  }
  return [...new Set(hits)];
}

export function primaryTopic(text: string): string {
  return extractTopics(text)[0] ?? 'altalanos';
}
