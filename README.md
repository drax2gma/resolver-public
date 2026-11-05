# resolver

> Self-hosted, no-login ticket-routing pilot: YAML router + SQLite feedback +
> optional local LLM.
>
> GitHub: <https://github.com/drax2gma/resolver-public>

Egyoldalas (SPA) jegy-routing pilot: bejövő `.txt` jegy → javaslat, hogy **kinek**
és **miért** kerüljön, a fix YAML router + a közös SQLite-tudásbázis alapján.
Nincs login; a visszajelzés anonim, de a tudásbázis közös.

## Mi ez

- **YAML a fix router**: megoldók, helyettesek, szervezetek, témakörök, szabályok.
- **SQLite a tanult tudás**: anonim 👍/👎 visszajelzésekből épülő példák és
  témakör-szintű affinitás.
- **Opcionális helyi LLM** (ollama, CPU is elég) választ a szűkített jelöltlistából;
  a „miért” determinisztikus része (témakör, szabály, hasonló eset) mindig látszik.
- **Egy oldal**: drag & drop `.txt`, beillesztés, vagy minta jegyek; nincs
  inbox/dispatch/report/login. A „Router” fülön közvetlenül szerkeszthető
  a `router.yaml` (megoldók, témakörök, szabályok).

## Gyors indítás

Követelmény: **Node.js >= 22.5** (a `node:sqlite` miatt); ajánlott a Node 24.

```bash
cp .env.example .env
npm install
MODEL_PROVIDER=fake npm run dev
# http://127.0.0.1:5173/
```

A `fake` provider determinisztikus retrieval-baseline; ollama nélkül is
végigvihető a jegy → javaslat → visszajelzés flow. A SQLite séma automatikusan
létrejön; seedelt példák nincsenek, a tudásbázis a visszajelzésekből épül.

### Opcionális: ollama

```bash
ollama serve
ollama pull qwen3:1.7b

export MODEL_PROVIDER=ollama
export OLLAMA_URL=http://127.0.0.1:11434
export OLLAMA_MODEL=qwen3:1.7b
npm run dev
```

A válaszok `latencyMs` értéke a UI-ban látszik. 8 GB RAM-on az 1.7B Q4 a
biztonságos kiindulás; nagyobb modell csak mérés után.

## YAML router

| Fájl | Tartalom |
|---|---|
| `router.yaml` | **egyetlen igazságforrás**: szervezetek, megoldók, témakörök, szabályok |

A `router.yaml` négy kulcsot tartalmaz: `szervezetek` (kanonikus lista),
`megoldok`, `temakorok`, `szabalyok`. A megoldó `temakorok` mezője a
`temakorok[].id`-kre hivatkozik; a témakör `nev` + `kulcsszavak` párból áll,
a szabály pedig `szoveg` + `kulcsszavak`. A megoldó szervezetei, témakör-ID-i
és a helyettese is ebben az egy fájlban élnek, így nincs több, egymásnak
ellentmondó részconfig. A „Router” fülön a `router.yaml` szerkeszthető;
mentéskor a szerver a teljes fájlt validálja (séma, duplikátumok,
szervezet-/témakör-/megoldó-hivatkozások), és csak hiba esetén utasít el.
A SQLite csak a tanult tudást tárolja (`examples`, `topic_stats`);
a megoldók és szabályok nem kerülnek a DB-be.

## API

- `POST /api/recommend` — `{ text }` → `primary`, `alternatives`, `confidence`, `why`.
- `POST /api/feedback` — anonim 👍/👎; 👎 esetén személy/szervezet + indoklás.
- `GET /api/tickets` — a `tickets/` mappa `.txt` fájljai (minta jegyek).
- `GET /api/router` — az editorhoz: megoldók (a feedback-választóhoz),
  szervezetek, darabszámok és a `router.yaml` tartalma (`hash`, `lines`).
- `PUT /api/router/source` — `{ content, baseHash }`; a teljes fájlt
  validálja, backupot készít, 409-et ad, ha a fájl közben változott.
- `GET /api/health` — DB + modell állapot.

## Parancsok

```bash
npm run check      # svelte-check
npm test           # unit + pipeline tesztek (in-memory SQLite)
npm run build      # adapter-node build (SPA + API)
npm run e2e        # buildelt szerver + API flow (fake provider)
npm run db:reset   # tiszta helyi DB (az anonim tudás is törlődik)
```

### Makefile

A gyakori lépésekhez van `Makefile` is:

```bash
make help          # targetek és az aktuális változók
make install       # npm ci
make dev           # fejlesztői szerver (MODEL_PROVIDER=fake)
make verify        # check + test + e2e
make build         # produkciós build
make serve         # build + node build (HOST/PORT env-vel)
make package       # telepíthető tarball
make backup        # SQLite backup + integrity_check
```

Példa produkciós indításra:

```bash
make serve HOST=127.0.0.1 PORT=3000 DATA_DIR=/var/lib/resolver \
  DB_PATH=/var/lib/resolver/resolver.db
```

## Architektúra

```
Svelte SPA (ssr=false)
  ├─ drag & drop / paste / minta jegyek
  ├─ POST /api/recommend
  └─ POST /api/feedback (anonim)
        │
        ▼
  SvelteKit adapter-node (HOST:PORT)
  ├─ YAML router (router.yaml)
  ├─ SQLite: examples + topic_stats
  └─ opcionális ollama (/api/chat, JSON mód)
```

- `predictText()`: retrieval → 5–6 jelölt → prompt (szabályok + hasonló esetek)
  → validált JSON → specialista-prior → confidence.
- `submitFeedback()`: anonim példa + topic-statisztika újraszámolás.
- A modell válasza soha nem fut le; ismeretlen solver ID-t eldobunk.

## Self-hosting

A részletes, semleges telepítési útmutató: [`deploy/README.md`](deploy/README.md).
Röviden: `npm ci && npm run build && npm prune --omit=dev`, majd
`HOST=127.0.0.1 PORT=3000 DATA_DIR=/var/lib/resolver DB_PATH=/var/lib/resolver/resolver.db node build`.

**Biztonság:** a pilotnak **nincs beépített authentikációja**, és a Router fül
írási endpointja is nyitott. Csak VPN, illetve reverse proxy mögötti auth
(Basic Auth / OIDC) után tedd ki nyilvános internetre.

## Minta adatok

A `router.yaml`, a `tickets/` és a dokumentáció név-/szervezetadatai kitalált
példák. A `tickets/DEMO-*.txt` fájlok szintetikus demo jegyek, nem valós
események, és nem tartalmaznak valós projekt-, cég- vagy hostneveket.
Éles használat előtt cseréld le őket a saját névteretekre.

## Ismert korlátok

- Nincs beégetett ground truth vagy seed; a tanulás kizárólag a visszajelzésekből
  épül, ezért az első időszakban kevés a hasonló eset.
- A 10 minta ticket csak bemeneti példa, nem mérési alap.
- A CPU-s 1.7B modell top-1 pontossága szerény; a top-3 és a determinisztikus
  „miért” a biztonsági háló. A visszajelzés javítja a rangsort.
- Nincs beépített auth: éles környezetben reverse proxy auth vagy VPN kell.

## Licenc

Apache-2.0 — lásd [`LICENSE`](LICENSE).
