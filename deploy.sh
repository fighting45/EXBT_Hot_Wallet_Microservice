#!/usr/bin/env bash
set -euo pipefail

APP="exbt-wallet"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log()  { echo "[deploy] $*"; }
fail() { echo "[deploy] ERROR: $*" >&2; exit 1; }

cd "$DIR"

# ── 1. Pull latest code ───────────────────────────────────────────────────────
log "Pulling latest code from origin/main..."
git pull origin main

# ── 2. Install dependencies (including devDeps needed for build) ──────────────
log "Installing dependencies..."
npm ci

# ── 3. Build TypeScript ───────────────────────────────────────────────────────
log "Building..."
./node_modules/.bin/nest build

# ── 4. Prune devDependencies after build ──────────────────────────────────────
log "Pruning dev dependencies..."
npm prune --omit=dev

# ── 5. Run migrations ─────────────────────────────────────────────────────────
log "Running migrations..."
node migrations/run.js || fail "Migrations failed — aborting before restart"

# ── 6. Reload PM2 (zero-downtime) ─────────────────────────────────────────────
if pm2 describe "$APP" > /dev/null 2>&1; then
  log "Reloading PM2 process '$APP'..."
  pm2 reload "$APP" --update-env
else
  log "PM2 process '$APP' not found — starting fresh..."
  pm2 start ecosystem.config.js
fi

pm2 save

log "Done. Current status:"
pm2 show "$APP"

log "Recent logs:"
pm2 logs "$APP" --lines 50 --nostream
