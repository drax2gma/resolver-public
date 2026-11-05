export function normalizeHu(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const SYNONYMS: Record<string, string> = {
  szolgaltatas: 'service',
  szolgaltatasok: 'service',
  szolgaltatast: 'service',
  ujraindul: 'reboot',
  ujraindult: 'reboot',
  ujraindultak: 'reboot',
  ujraindulas: 'reboot',
  reboot: 'reboot',
  indul: 'start',
  indult: 'start',
  indultak: 'start',
  inditas: 'start',
  inditasa: 'start',
  inditani: 'start',
  mentes: 'backup',
  mentesek: 'backup',
  mentest: 'backup',
  backup: 'backup',
  tarolo: 'storage',
  tarolok: 'storage',
  storage: 'storage',
  lemez: 'disk',
  lemezek: 'disk',
  disk: 'disk',
  jogosultsag: 'permission',
  jogosultsagok: 'permission',
  permission: 'permission',
  fiok: 'account',
  fiokok: 'account',
  fiokot: 'account',
  account: 'account',
  tanusitvany: 'cert',
  tanusitvanyok: 'cert',
  cert: 'cert',
  halozat: 'network',
  halozati: 'network',
  network: 'network',
  hiba: 'error',
  hibak: 'error',
  error: 'error',
  telepites: 'install',
  telepitese: 'install',
  install: 'install',
  beallitas: 'config',
  beallitasok: 'config',
  config: 'config'
};

function canonical(token: string): string {
  const direct = SYNONYMS[token];
  if (direct) return direct;
  for (const suffix of ['ok', 'ek', 'ak', 'ot', 'et', 'at', 'k', 't']) {
    if (token.length > suffix.length + 2 && token.endsWith(suffix)) {
      const stem = token.slice(0, -suffix.length);
      const mapped = SYNONYMS[stem];
      if (mapped) return mapped;
    }
  }
  return token;
}

export function tokens(input: string): Set<string> {
  return new Set(
    normalizeHu(input)
      .split(' ')
      .filter((t) => t.length > 2)
      .map(canonical)
  );
}

export function jaccard(a: string, b: string): number {
  const sa = tokens(a);
  const sb = tokens(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let intersection = 0;
  for (const token of sa) if (sb.has(token)) intersection += 1;
  return intersection / (sa.size + sb.size - intersection);
}

export function includesNormalized(haystack: string, needle: string): boolean {
  const h = ` ${normalizeHu(haystack)} `;
  const n = normalizeHu(needle);
  return n.length > 0 && h.includes(` ${n} `);
}

export function slugify(input: string): string {
  return normalizeHu(input).replace(/\s+/g, '-') || 'ismeretlen';
}

export function truncate(input: string, max: number): string {
  return input.length <= max ? input : `${input.slice(0, max - 1)}…`;
}
