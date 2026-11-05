import { spawn, type ChildProcess } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb } from '../src/lib/server/db';

const PORT = 4173;
const BASE = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(join(tmpdir(), 'resolver-spa-e2e-'));
const dataRoot = join(dir, 'app');
const dbPath = join(dir, 'resolver.db');

cpSync('router.yaml', join(dataRoot, 'router.yaml'));
cpSync('tickets', join(dataRoot, 'tickets'), { recursive: true });
process.env.DATA_DIR = dataRoot;

const db = createDb(dbPath);

let server: ChildProcess | undefined;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`E2E hiba: ${message}`);
}

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 80; i += 1) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) return;
    } catch {
      // még indul
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('A szerver nem indult el');
}

async function json<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const response = await fetch(`${BASE}${path}`, init);
  const body = (await response.json()) as T;
  return { status: response.status, body };
}

async function saveSource(
  content: string,
  baseHash: string
): Promise<{ status: number; body: { ok?: boolean; hash?: string; warnings?: string[]; message?: string } }> {
  return json('/api/router/source', {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      origin: BASE,
      'x-forwarded-proto': 'http'
    },
    body: JSON.stringify({ content, baseHash })
  });
}

async function main(): Promise<void> {
  server = spawn(process.execPath, ['build'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      PROTOCOL_HEADER: 'x-forwarded-proto',
      DB_PATH: dbPath,
      MODEL_PROVIDER: 'fake',
      DATA_DIR: dataRoot
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stderr?.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));

  await waitForServer();

  const page = await fetch(`${BASE}/`);
  const html = await page.text();
  assert(page.status === 200, `SPA HTTP ${page.status}`);
  assert(html.includes('<!doctype html'), 'az SPA nem töltődött be');

  const router = await json<{
    solvers: Array<{ id: string; nev: string; szervezet: string; szerep: string }>;
    orgs: string[];
    counts: { solvers: number; topics: number; rules: number };
    source: { content: string; hash: string; lines: number };
  }>('/api/router');
  assert(router.status === 200, `router HTTP ${router.status}`);
  assert(router.body.solvers.length === 22, 'nem 22 megoldó jött vissza');
  assert(router.body.orgs.length > 0, 'nincs szervezet');
  assert(router.body.counts.topics > 0, 'nincs témakör a routerben');
  assert(router.body.counts.rules > 0, 'nincs szabály a routerben');
  const routerSource = router.body.source;
  assert(routerSource.content.includes('megoldok:'), 'a router.yaml tartalma hibás');
  assert(routerSource.content.includes('temakorok:'), 'a router.yaml témakör-szekciója hibás');
  assert(routerSource.lines > 0, 'a router.yaml sorszám hibás');

  const invalid = await saveSource('szervezetek: [', routerSource.hash);
  assert(invalid.status === 400, `a hibás YAML mentése nem 400: ${invalid.status} ${JSON.stringify(invalid.body)}`);
  assert(invalid.body.message?.includes('router.yaml'), 'a hibaüzenet nem fájl-specifikus');

  const missing = await json('/api/router/source', {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      origin: BASE,
      'x-forwarded-proto': 'http'
    },
    body: JSON.stringify({})
  });
  assert(missing.status === 400, `a hiányos kérés nem 400: ${missing.status}`);

  const stale = await saveSource(routerSource.content, 'deadbeef');
  assert(stale.status === 409, `az elavult hash nem 409: ${stale.status}`);

  const noop = await saveSource(routerSource.content, routerSource.hash);
  assert(noop.status === 200, `a no-op mentés nem 200: ${noop.status}`);
  assert(noop.body.ok === true && noop.body.hash === routerSource.hash, 'a no-op hash hibás');

  const editedContent = `${routerSource.content}\n# e2e edit\n`;
  const edited = await saveSource(editedContent, routerSource.hash);
  assert(edited.status === 200, `a szerkesztett mentés nem 200: ${edited.status}`);
  assert(edited.body.hash !== routerSource.hash, 'a szerkesztett hash nem változott');

  const afterEdit = await json<{ source: { content: string } }>('/api/router');
  assert(afterEdit.body.source.content.includes('# e2e edit'), 'a mentés nem jelent meg a routerben');

  const restore = await saveSource(routerSource.content, edited.body.hash!);
  assert(restore.status === 200, `a visszaállítás nem 200: ${restore.status}`);

  const tickets = await json<{ tickets: Array<{ externalId: string; rawText: string }> }>(
    '/api/tickets'
  );
  assert(tickets.status === 200, `tickets HTTP ${tickets.status}`);
  assert(tickets.body.tickets.length === 10, 'nem 10 minta ticket jött vissza');
  const ticket = tickets.body.tickets[0]!;

  const recommend = await json<{
    primary: { id: string; nev: string };
    alternatives: unknown[];
    confidence: number;
    why: { topics: unknown[]; rules: unknown[] };
  }>('/api/recommend', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ text: ticket.rawText, filename: ticket.externalId })
  });
  assert(recommend.status === 200, `recommend HTTP ${recommend.status}`);
  assert(recommend.body.primary?.id, 'nincs elsődleges megoldó');
  assert(recommend.body.confidence > 0, 'nincs confidence');
  assert(recommend.body.why.topics.length > 0, 'nincs témakör a miértben');

  const feedback = await json<{ ok: boolean }>('/api/feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({
      ticketText: ticket.rawText,
      primaryId: recommend.body.primary.id,
      verdict: 'up'
    })
  });
  assert(feedback.status === 200, `feedback HTTP ${feedback.status}`);
  assert(feedback.body.ok === true, 'a feedback nem ok');

  const feedbackRow = db.prepare("SELECT COUNT(*) AS c FROM examples WHERE source = 'anonymous'").get() as {
    c: number;
  };
  assert(feedbackRow.c === 1, 'a feedback nem íródott be');

  const health = await json<{ ok: boolean; db: { examples: number } }>('/api/health');
  assert(health.status === 200, `health HTTP ${health.status}`);
  assert(health.body.db.examples >= 1, 'a health nem látja a példát');

  console.log('E2E OK: SPA → router → edit/validate → tickets → recommend → feedback → health');
}

try {
  await main();
} finally {
  server?.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 300));
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
