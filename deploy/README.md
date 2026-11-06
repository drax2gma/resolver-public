# Self-hosting

A resolver egy Node-szolgáltatás (SvelteKit adapter-node), SQLite-tal és
opcionális helyi LLM-mel. Az alábbi példa systemd + nginx alatt mutatja a
telepítést; bármilyen Node-host, konténer vagy PaaS használható.

## Követelmények

- **Node.js >= 22.5** (a `node:sqlite` miatt); Node 24 ajánlott.
- 1 vCPU / 1 GB RAM az appnak; ollama CPU-hoz 2 vCPU / 8 GB körül.
- Opcionális: ollama, nginx/Caddy, `sqlite3` CLI (backuphoz).

## 1. Build

```bash
git clone https://github.com/drax2gma/resolver-public.git /opt/resolver
cd /opt/resolver
npm ci
npm run build
npm prune --omit=dev
```

Vagy a Makefile-lal:

```bash
make install
make build
```

A futtatáshoz csak a `build/`, a `package.json` és a `node_modules` kell.
Telepíthető tarball: `make package`.

## 2. Futó config, adatbázis, env

```bash
useradd --system --home /var/lib/resolver --shell /usr/sbin/nologin resolver 2>/dev/null || true
install -d -o resolver -g resolver /var/lib/resolver

install -o resolver -g resolver -m 0644 router.yaml /var/lib/resolver/router.yaml
cp -r tickets /var/lib/resolver/
chown -R resolver:resolver /var/lib/resolver
```

A futó config a `DATA_DIR` alatt él, így a kódfrissítés nem írja felül. A
`router.yaml` a repóban csak default; éles config-csere előtt készíts backupot.

`/etc/resolver/env` (600, root):

```bash
HOST=127.0.0.1
PORT=3000
NODE_ENV=production
DATA_DIR=/var/lib/resolver
DB_PATH=/var/lib/resolver/resolver.db

MODEL_PROVIDER=ollama
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3.5:2b
MODEL_TIMEOUT_MS=240000
MODEL_NUM_CTX=4096
MODEL_NUM_PREDICT=120
OLLAMA_NUM_THREAD=4

# Csak reverse proxy mögött:
PROTOCOL_HEADER=x-forwarded-proto
```

Ha nincs reverse proxy, a `PROTOCOL_HEADER` maradjon ki. A `HOST=127.0.0.1`
csak helyi/proxy elérést enged; közvetlen hálózati eléréshez `0.0.0.0`, de ez
csak megbízható hálózaton javasolt.

A SQLite séma az első indításkor automatikusan létrejön; nincs seed lépés.

## 3. Systemd

```bash
install -m 0644 deploy/resolver.service /etc/systemd/system/resolver.service
# Igazítsd a unitban a WorkingDirectory, EnvironmentFile, ReadWritePaths,
# User/Group és ExecStart útvonalakat!
systemctl daemon-reload
systemctl enable --now resolver
curl -s http://127.0.0.1:3000/api/health
```

## 4. Reverse proxy és auth

Az appnak **nincs beépített authentikációja**. Élesben tedd VPN vagy reverse
proxy mögötti auth (Basic Auth / OIDC) mögé, és használj HTTPS-t.

```bash
cp deploy/nginx.conf.example /etc/nginx/conf.d/resolver.conf
# server_name, TLS, auth beállítása
nginx -t
systemctl reload nginx
```

Basic Auth példa:

```bash
apt install apache2-utils
htpasswd -c /etc/nginx/.htpasswd admin
```

A proxy mintában a `Host` és az `X-Forwarded-Proto` fejléc átadása azért kell,
hogy a SvelteKit a helyes origin-t lássa (a Router mentés origin-ellenőrzése és
a redirectek miatt).

## 5. Ollama (opcionális)

Ha nem kell modell, `MODEL_PROVIDER=fake` is elég; a retrieval-baseline
ollama nélkül is végigviszi a flow-t.

```bash
# Telepítés az ollama dokumentációja szerint, majd:
ollama pull qwen3.5:2b
```

CPU-s systemd minta: `deploy/ollama.service`. A modell mérete és a
`MODEL_NUM_CTX`/`MODEL_NUM_PREDICT` értékek a rendelkezésre álló RAM-hoz
igazíthatók. A pilot élő beállítása `qwen3.5:2b` (2,7 GB): új prompt ~50–70 s,
cache-elt ismétlés ~4 s. Kisebb RAM-on vagy alacsonyabb latency-igénynél a
`qwen3:1.7b` (1,4 GB) a gyorsabb alternatíva.

## 6. Backup

```bash
install -d -o resolver -g resolver /var/backups/resolver
runuser -u resolver -- sqlite3 /var/lib/resolver/resolver.db \
  ".backup '/var/backups/resolver/resolver-$(date +%F).db'"
sqlite3 /var/backups/resolver/resolver-$(date +%F).db 'PRAGMA integrity_check;'
```

Napi cron példa:

```cron
17 3 * * * resolver sqlite3 /var/lib/resolver/resolver.db ".backup '/var/backups/resolver/resolver-$(date +\%F).db'" && find /var/backups/resolver -name 'resolver-*.db' -mtime +14 -delete
```

A UI-s router-mentések külön backupot készítenek:
`DATA_DIR/data/.backups/` (20 fájl/forrás).

## 7. Frissítés

```bash
cd /opt/resolver
git pull
npm ci
npm run build
npm prune --omit=dev
chown -R resolver:resolver /opt/resolver
systemctl restart resolver
curl -s http://127.0.0.1:3000/api/health
```

A futó `DATA_DIR/router.yaml` és a DB érintetlen marad. Ha a repó default
`router.yaml`-ját is frissíteni akarod, azt tudatosan másold a `DATA_DIR` alá,
előtte backupolva.

## 8. Router szerkesztése a UI-ból

- A „Router” fül a `DATA_DIR` alatti `router.yaml`-t szerkeszti.
- Mentéskor a szerver a **teljes** fájlt validálja (séma, duplikált azonosítók,
  szervezet-/témakör-/megoldó-hivatkozások); hibás tartalom nem íródik ki.
- Minden mentés előtt backup készül: `DATA_DIR/data/.backups/`.
- Ha a fájl közben megváltozott, a mentés 409-cel elutasítja (hash-ellenőrzés).
- A szolgáltatás userének írása legyen a `DATA_DIR`-ra. `ProtectSystem=strict`
  mellett a unit `ReadWritePaths`-jában is szerepeljen.

## Biztonsági checklist

- [ ] Az app csak VPN vagy auth-os reverse proxy mögött érhető el.
- [ ] `HOST=127.0.0.1`, ha proxy mögött fut.
- [ ] HTTPS a proxy végponton.
- [ ] A `DATA_DIR` és a DB jogosultsága csak a szolgáltatás useré.
- [ ] Secret nem kerül a repóba; env változóból vagy titokkezelőből jön.
- [ ] Rendszeres SQLite backup + `PRAGMA integrity_check`.

## Gyakori hibák

- **`node:sqlite` hiányzik / régi Node**: legalább Node 22.5 kell.
- **Rossz origin a Router mentésnél**: hiányzik a `PROTOCOL_HEADER` vagy a
  proxy nem adja át a `Host` fejlécet.
- **`EROFS` / permission hiba mentéskor**: a `DATA_DIR` nincs a unit
  `ReadWritePaths`-jában, vagy nem a szolgáltatás useré.
- **Lassú első válasz**: az ollama hidegen 40–65 s lehet; utána a prompt-cache
  miatt 5–15 s.
