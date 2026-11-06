# AGENTS.md — resolver

Egyoldalas (SPA) jegy-routing pilot: fix YAML router + közös SQLite-tanulás +
opcionális helyi LLM. Nincs login; auth nélkül csak VPN vagy reverse proxy
mögötti auth esetén szabad kitenni.

## Fejlesztés és ellenőrzés

- Node >= 22.5 kell (`node:sqlite`); a termelésben Node 24 ajánlott.
- `MODEL_PROVIDER=fake npm run dev` (`127.0.0.1:5173`); a SQLite séma
  automatikusan létrejön, seed nincs. Provider nélkül is fake az alap; ollama
  csak tudatos méréshez kell.
- Ellenőrzési sorrend: `npm run check && npm test && npm run build && npm run e2e`.
  Az `e2e` a kész `build/`-et indítja (`node build`), tehát build nélkül elhasal;
  saját temp DB-t és 4173-as portot használ.
- Egy teszt: `npx vitest run tests/pipeline.test.ts -t "feedback"`.

## Architektúra

- SvelteKit 3 + Svelte 5 runes, adapter-node. `src/routes/+layout.ts`: `ssr = false`,
  ezért a UI kliens-oldalon renderel; a `curl /` csak üres shellt ad. Tartalmat
  headless Chrome-mal ellenőrizz: `--dump-dom 'http://127.0.0.1:5173/#router'`.
- Egy oldal, két fül: `Jegyek` és `Router`; deep link `/#router`.
- API: `POST /api/recommend`, `POST /api/feedback`, `PUT /api/router/source`,
  `GET /api/tickets|router|health`.
- A „Router” fül egyetlen CodeMirror-szerkesztőt ad a `router.yaml`-hoz (élő
  YAML lint); mentéskor a szerver validál. A write endpoint origin-ellenőrzött,
  de **nincs authentikálva** — a szerkesztőt csak védett hálózaton szabad hagyni.
- Predikció: `rankCandidates()` (YAML témakör + SQLite affinitás) → szűk
  jelöltlista → prompt → validált JSON → specialista-prior → confidence.
  Ismeretlen solver ID-t eldob; a modell nem írja felül a routert.
- A SQLite csak a tanult tudást tárolja: `examples`, `topic_stats`. A megoldók,
  szervezetek, témakörök és szabályok YAML-ban élnek.

## Router config — egyetlen YAML

- `router.yaml` az egyetlen igazságforrás: `szervezetek`, `megoldok` (nev, szerep,
  szervezetek, temakorok = témakör-ID-k, helyettes), `temakorok` (id, nev,
  kulcsszavak), `szabalyok` (szoveg, kulcsszavak).
- A megoldó minden szervezete szerepeljen a top-level `szervezetek` listában, és
  minden `temakorok`-érték a `temakorok[].id`-k között; a `buildSolvers()` ezt
  validálja. A helyettesnek létező megoldónak kell lennie.
- Nincs `topicIds`, `label`, `keywords`, `scope`, `weight`, `aktiv`: a régi séma
  nem kompatibilis, a fájlt egyben kell migrálni.
- Kézi/YAML szerkesztés után a config-cache miatt restart kell; a UI-s mentés
  invalidálja a cache-t, ezért restart nélkül azonnal érvényes.
- Témakör-találat normalizált, szóhatáros egyezés (`normalizeHu`); a kulcsszavakat
  ékezet nélkül, kisbetűvel vedd fel. Nincs találat → `altalanos`.

## SQLite / feedback csapdák

- Nincs migration framework: a séma `src/lib/server/schema.ts`, csak
  `CREATE TABLE IF NOT EXISTS`. Éles séma-változás előtt backup + kézi migráció.
- `submitFeedback()` egy tranzakcióban insertel, majd teljes `topic_stats`
  újraszámolást futtat. Ne tegyél külön BEGIN/COMMIT-ot a `recomputeTopicStats`-ba.
- 👎 szabály: megoldó VAGY szervezet kötelező, plusz >=5 karakter indoklás; a
  javasolt megoldó nem lehet az aktuális. Ez szándékos, ne lazítsd.
- A DB alapból üres: nincs seed, a tudás kizárólag az anonim visszajelzésekből
  épül. A `db:reset` a helyi `data/resolver.db`-t törli (a `DB_PATH`-ot nem
  veszi figyelembe); éles tudáson ne futtasd.

## Self-hosting

- A futó config a `DATA_DIR` alatt él (`router.yaml`, `tickets/`), a DB pedig a
  `DB_PATH`-on; a repó `router.yaml` csak default. Élesben abszolút útvonalakat
  használj, és a szolgáltatás userének legyen írása a `DATA_DIR`-ra.
- Minta systemd unit és nginx config: `deploy/`. A részletes útmutató:
  `deploy/README.md`.
- A UI-s router-mentés a `DATA_DIR/data/.backups/` alá ment (20/fájl), és
  hash-ütközésnél 409-cel elutasít.
- Reverse proxy mögött `PROTOCOL_HEADER=x-forwarded-proto` és a `Host` fejléc
  átadása kell a helyes originhez.
- Ollama: az élő modell `qwen3.5:2b`; CPU-n új prompt ~50–70 s, cache-elt
  ismétlés ~4 s. A `qwen3:1.7b` a gyorsabb alternatíva. A kérés szinkron,
  nincs job-queue.

## Egyéb

- SvelteKit 3: nincs `svelte.config.js`; a config a `vite.config.ts`-ben van.
  Az import alias `#lib` (package.json `imports` + tsconfig `paths`).
- A tesztek adatmennyiséget is állítanak (22 megoldó, 10 minta ticket): ha a
  dataset nő, a `tests/text.test.ts` és `scripts/e2e.ts` assertjeit is frissítsd.
- Secret soha a repóba: `.env` ignored, `.env.example` a séma; éles értékeket
  env változóként vagy titokkezelőből adj át.
