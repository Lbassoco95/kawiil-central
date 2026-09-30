#!/usr/bin/env bash
# =================================================================
# Verificación local de las migraciones de Múuch' (B1 + B3–B5).
#
# Levanta un Postgres temporal en /tmp/mtg-pg (puerto 54329), aplica
# stub → 5 migraciones mtg/job_queue → checks B1 + B345 → rollback de
# las 3 nuevas → re-aplica → checks → apaga el cluster.
#
# Log: tools/mtg/local-db/last-run.log (gitignored vía *.log) y
#      /tmp/mtg-verify.log
# =================================================================
set -euo pipefail

if [ -z "${PGBIN:-}" ]; then
  PGBIN="$(ls -d /opt/homebrew/Cellar/postgresql@*/*/bin 2>/dev/null | sort -V | tail -1)"
  PGBIN="${PGBIN:-/opt/homebrew/bin}"
  # Linux / apt fallback
  if [ ! -x "$PGBIN/initdb" ] && [ -x /usr/lib/postgresql/*/bin/initdb ]; then
    PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
  fi
fi
PGDATA=/tmp/mtg-pg/data
PGSOCK=/tmp/mtg-pg
PGPORT=54329
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
LOG_REPO="$REPO_ROOT/tools/mtg/local-db/last-run.log"
LOG=/tmp/mtg-verify.log
PSQL="$PGBIN/psql -h $PGSOCK -p $PGPORT -U postgres -d postgres -v ON_ERROR_STOP=1 -q"

if [ ! -x "$PGBIN/initdb" ]; then
  echo "ERROR: no hay initdb en PGBIN=$PGBIN — instala Postgres (brew install postgresql@16) [ALTO — Mac Polo]"
  exit 1
fi

exec > >(tee "$LOG" "$LOG_REPO") 2>&1

cleanup() {
  "$PGBIN/pg_ctl" -D "$PGDATA" -m fast stop >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "== verify mtg: init cluster =="
rm -rf /tmp/mtg-pg
mkdir -p "$PGDATA"
PGSHARE="$(cd "$PGBIN/../share/postgresql" 2>/dev/null && pwd || true)"
INITDB_L=()
if [ -n "$PGSHARE" ] && [ -f "$PGSHARE/postgres.bki" ]; then
  INITDB_L=(-L "$PGSHARE")
fi
"$PGBIN/initdb" -D "$PGDATA" -U postgres -E UTF8 "${INITDB_L[@]}" >/dev/null
"$PGBIN/pg_ctl" -D "$PGDATA" -l /tmp/mtg-pg/postgres.log \
  -o "-p $PGPORT -k $PGSOCK -c listen_addresses=''" start >/dev/null

echo "== 1. stub =="
$PSQL -f "$REPO_ROOT/tools/mtg/local-db/schema-stub.sql"

echo "== 2. B1 esquema + bucket =="
$PSQL -f "$REPO_ROOT/supabase/migrations/20260917120000_mtg_juntas_schema.sql"
$PSQL -f "$REPO_ROOT/supabase/migrations/20260917120100_mtg_storage_bucket.sql"

echo "== 3. B3–B5 (job_queue, unmatched, documents/slack) =="
$PSQL -f "$REPO_ROOT/supabase/migrations/20260918140000_job_queue.sql"
$PSQL -f "$REPO_ROOT/supabase/migrations/20260918140100_mtg_unmatched_transcripts.sql"
$PSQL -f "$REPO_ROOT/supabase/migrations/20260918140200_mtg_documents_group_and_slack.sql"

echo "== 4. checks B1 =="
$PSQL -f "$REPO_ROOT/tools/mtg/local-db/checks.sql"

echo "== 5. checks B345 =="
$PSQL -f "$REPO_ROOT/tools/mtg/local-db/checks-b345.sql"

echo "== 6. rollback de las 3 nuevas (orden inverso) =="
$PSQL -f "$REPO_ROOT/migrations/2026-09-18_mtg_documents_group_and_slack.rollback.sql"
$PSQL -f "$REPO_ROOT/migrations/2026-09-18_mtg_unmatched_transcripts.rollback.sql"
$PSQL -f "$REPO_ROOT/migrations/2026-09-18_job_queue.rollback.sql"

echo "== 7. re-aplicar las 3 nuevas =="
$PSQL -f "$REPO_ROOT/supabase/migrations/20260918140000_job_queue.sql"
$PSQL -f "$REPO_ROOT/supabase/migrations/20260918140100_mtg_unmatched_transcripts.sql"
$PSQL -f "$REPO_ROOT/supabase/migrations/20260918140200_mtg_documents_group_and_slack.sql"

echo "== 8. re-correr checks B345 =="
$PSQL -f "$REPO_ROOT/tools/mtg/local-db/checks-b345.sql"

echo "== verify mtg B1+B345: OK =="
