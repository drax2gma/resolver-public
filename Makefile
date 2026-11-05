SHELL := /bin/bash
.DEFAULT_GOAL := help

APP_NAME := resolver
MODEL_PROVIDER ?= fake
HOST ?= 127.0.0.1
PORT ?= 3000
DATA_DIR ?= .
DB_PATH ?= ./data/resolver.db
BACKUP_DIR ?= ./backups

export MODEL_PROVIDER HOST PORT DATA_DIR DB_PATH

.PHONY: help install dev check test e2e verify build serve package backup db-reset clean distclean

help: ## Elérhető targetek
	@awk 'BEGIN {FS = ":.*## "; printf "\nHasználat: make <target>\n\n"} /^[a-zA-Z0-9_-]+:.*## / {printf "  %-12s %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@printf "\nVáltozók: MODEL_PROVIDER=%s HOST=%s PORT=%s DATA_DIR=%s DB_PATH=%s\n\n" "$(MODEL_PROVIDER)" "$(HOST)" "$(PORT)" "$(DATA_DIR)" "$(DB_PATH)"

install: ## Függőségek telepítése (npm ci)
	npm ci

dev: ## Fejlesztői szerver (alapból fake provider)
	npm run dev

check: ## Svelte/TypeScript ellenőrzés
	npm run check

test: ## Unit- és pipeline-tesztek
	npm test

e2e: build ## Buildelt szerver + API e2e
	npm run e2e

verify: check test e2e ## Teljes ellenőrzés (check + test + e2e)

build: ## Produkciós build
	npm run build

serve: build ## Build után indítás (HOST/PORT env-vel)
	node build

package: build ## Telepíthető tarball készítése
	tar -czf "$(APP_NAME)-$$(date +%Y%m%d-%H%M).tar.gz" \
		build package.json package-lock.json router.yaml tickets deploy README.md LICENSE .env.example

backup: ## SQLite backup + integrity check
	@test -f "$(DB_PATH)" || { echo "Nincs adatbázis: $(DB_PATH)"; exit 1; }
	@mkdir -p "$(BACKUP_DIR)"
	@file="$(BACKUP_DIR)/$(APP_NAME)-$$(date +%F-%H%M%S).db"; \
		sqlite3 "$(DB_PATH)" ".backup '$$file'"; \
		sqlite3 "$$file" 'PRAGMA integrity_check;'; \
		echo "Backup: $$file"

db-reset: ## Helyi DB törlése (CONFIRM=1 kötelező)
	@test "$(CONFIRM)" = "1" || { echo "FIGYELEM: törli a helyi DB-t ($(DB_PATH)). Használat: make db-reset CONFIRM=1"; exit 1; }
	rm -f "$(DB_PATH)" "$(DB_PATH)-shm" "$(DB_PATH)-wal"

clean: ## Build és SvelteKit cache törlése
	rm -rf build .svelte-kit
	rm -f "$(APP_NAME)"-*.tar.gz

distclean: clean ## clean + node_modules törlése
	rm -rf node_modules
