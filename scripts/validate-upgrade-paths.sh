#!/usr/bin/env bash
# Upgrade-path validation (Phase 10.7): proves the forward-only migration
# chain upgrades cleanly from BOTH historical baselines:
#   1. 000001–000039 (the pre-consolidation remote ledger) → latest
#   2. 000055 (the currently live staging ledger) → latest
#
# Each baseline is applied from zero, fictional legacy fixtures are inserted
# where the baseline requires them, and the remaining migrations are applied
# with ON_ERROR_STOP. Smoke assertions verify the upgraded surface.
set -euo pipefail

PGPORT="${FASS_UPGRADE_PORT:-5434}"
PSQL=(psql -h /tmp -p "$PGPORT" -U postgres)

cleanup() {
  pg_ctl -D "$PGDATA_A" stop -m fast >/dev/null 2>&1 || true
  pg_ctl -D "$PGDATA_B" stop -m fast >/dev/null 2>&1 || true
  rm -rf "$PGDATA_A" "$PGDATA_B"
}
PGDATA_A="$(mktemp -d /tmp/fass-upg-a.XXXXXX)"
PGDATA_B="$(mktemp -d /tmp/fass-upg-b.XXXXXX)"
trap cleanup EXIT

initdb -D "$PGDATA_A" -U postgres --auth=trust -E UTF8 --locale=C >/dev/null
pg_ctl -D "$PGDATA_A" -o "-p $PGPORT -k /tmp" -l "$PGDATA_A/server.log" start >/dev/null

stub_auth() {
  "${PSQL[@]}" -d "$1" -q <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create table auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql as $fn$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $fn$;
create or replace function auth.jwt() returns jsonb language sql as $fn$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $fn$;
SQL
}

apply_migrations() {
  local db="$1"; shift
  for f in "$@"; do
    "${PSQL[@]}" -d "$db" -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null
  done
}

migrations_upto() {
  local limit="$1"
  for f in supabase/migrations/*.sql; do
    local base
    base="$(basename "$f" | cut -d_ -f1)"
    if [[ "$base" < "$limit" || "$base" == "$limit" ]]; then echo "$f"; fi
  done
}

migrations_after() {
  local limit="$1"
  for f in supabase/migrations/*.sql; do
    local base
    base="$(basename "$f" | cut -d_ -f1)"
    if [[ "$base" > "$limit" ]]; then echo "$f"; fi
  done
}

smoke() {
  local db="$1" label="$2"
  local counts
  counts="$("${PSQL[@]}" -d "$db" -t -A -c "
    select 'students=' || (select count(*) from public.students)
        || ' staff_members=' || (select count(*) from public.staff_members)
        || ' teaching_assignments=' || (select count(*) from public.teaching_assignments)
        || ' import_batches=' || (select count(*) from public.data_import_batches)
        || ' claims=' || (select count(*) from public.guardian_claim_invitations)
        || ' exports=' || (select count(*) from public.data_export_requests)
        || ' rls_tables=' || (select count(*) from pg_tables where schemaname = 'public' and rowsecurity)
  ")"
  echo "  [$label] $counts"
  local null_person
  null_person="$("${PSQL[@]}" -d "$db" -t -A -c "select count(*) from public.staff_members where person_id is null")"
  if [[ "$null_person" != "0" ]]; then
    echo "FAIL [$label]: staff_members.person_id has $null_person nulls after upgrade"
    exit 1
  fi
  echo "  [$label] smoke OK"
}

# ---------------------------------------------------------------------------
# Baseline A: 000001–000039 → latest (the pre-consolidation remote ledger)
# ---------------------------------------------------------------------------
echo "== upgrade path A: 000001–000039 → latest"
createdb -h /tmp -p "$PGPORT" -U postgres fass_upg_a
stub_auth fass_upg_a
BASE_A=()
while IFS= read -r f; do BASE_A+=("$f"); done < <(migrations_upto 000039)
apply_migrations fass_upg_a "${BASE_A[@]}"
"${PSQL[@]}" -d fass_upg_a -q -f supabase/seed.sql >/dev/null
REST_A=()
while IFS= read -r f; do REST_A+=("$f"); done < <(migrations_after 000039)
apply_migrations fass_upg_a "${REST_A[@]}"
smoke fass_upg_a "A: 000039 → latest"
pg_ctl -D "$PGDATA_A" stop -m fast >/dev/null

# ---------------------------------------------------------------------------
# Baseline B: 000001–000055 → latest (the currently live staging ledger)
# ---------------------------------------------------------------------------
echo "== upgrade path B: 000001–000055 → latest"
initdb -D "$PGDATA_B" -U postgres --auth=trust -E UTF8 --locale=C >/dev/null
pg_ctl -D "$PGDATA_B" -o "-p $PGPORT -k /tmp" -l "$PGDATA_B/server.log" start >/dev/null
createdb -h /tmp -p "$PGPORT" -U postgres fass_upg_b
stub_auth fass_upg_b
BASE_B=()
while IFS= read -r f; do BASE_B+=("$f"); done < <(migrations_upto 000055)
apply_migrations fass_upg_b "${BASE_B[@]}"
"${PSQL[@]}" -d fass_upg_b -q -f supabase/seed.sql >/dev/null
REST_B=()
while IFS= read -r f; do REST_B+=("$f"); done < <(migrations_after 000055)
apply_migrations fass_upg_b "${REST_B[@]}"
smoke fass_upg_b "B: 000055 → latest"
pg_ctl -D "$PGDATA_B" stop -m fast >/dev/null

echo "ALL UPGRADE PATH CHECKS PASSED"
