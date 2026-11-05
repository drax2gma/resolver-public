import type { TicketInput } from './types';

function normalizeKey(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '');
}

function parseFields(header: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of header.split(/\r?\n/)) {
    const match = line.match(/^([^:]+?)\s*:\s*(.*)$/);
    if (!match) continue;
    const key = normalizeKey(match[1]);
    const value = match[2].trim();
    if (value) fields.set(key, value);
  }
  return fields;
}

/**
 * A pilot .txt formátumát és a szabad szöveget is kezeli.
 * A böngésző és a szerver is ezt használja (nincs Node-import).
 */
export function parseTicketText(text: string, fallbackId = 'JEGY'): TicketInput {
  const rawText = text.trim();
  const idMatch = rawText.match(/TICKET:\s*(\S+)/);
  const externalId = idMatch?.[1] ?? fallbackId;

  const bodyMatch = rawText.match(/Le[íi]r[áa]s\s*:/i);
  const header = bodyMatch ? rawText.slice(0, bodyMatch.index ?? 0) : rawText;
  const fields = parseFields(header);

  let body = bodyMatch
    ? rawText.slice((bodyMatch.index ?? 0) + bodyMatch[0].length)
    : rawText;
  const endMarker = body.indexOf('============================================================');
  if (endMarker >= 0) body = body.slice(0, endMarker);
  body = body.trim();

  const firstLine = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return {
    externalId,
    targy: fields.get('targy') ?? firstLine ?? externalId,
    leiras: body || rawText,
    kategoria: fields.get('kategoria') ?? null,
    prioritas: fields.get('prioritas') ?? null,
    bejelento: fields.get('bejelento') ?? null,
    erintett: fields.get('erintett') ?? null,
    rawText
  };
}
