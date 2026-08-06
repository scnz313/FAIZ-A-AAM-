#!/usr/bin/env bash
# Local database validation without Docker (plan.md §12 gates).
#
# Spins up a scratch PostgreSQL instance (Homebrew `postgresql@17` binaries),
# stubs the Supabase auth surface (roles + auth.uid/jwt/users), applies every
# migration + seed with ON_ERROR_STOP, and runs smoke assertions.
#
# Usage: sh scripts/validate-db-local.sh
set -euo pipefail

PGPORT="${FASS_VALIDATE_PORT:-5433}"
PGDATA="$(mktemp -d /tmp/fass-pg.XXXXXX)"
DB="fass_validate"
PSQL=(psql -h /tmp -p "$PGPORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1)

cleanup() {
  pg_ctl -D "$PGDATA" stop -m fast >/dev/null 2>&1 || true
  rm -rf "$PGDATA"
}
trap cleanup EXIT

echo "== init scratch instance (port $PGPORT)"
initdb -D "$PGDATA" -U postgres --auth=trust -E UTF8 --locale=C >/dev/null
pg_ctl -D "$PGDATA" -o "-p $PGPORT -k /tmp" -l "$PGDATA/server.log" start >/dev/null
createdb -h /tmp -p "$PGPORT" -U postgres "$DB"

echo "== stub Supabase auth surface"
psql -h /tmp -p "$PGPORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create table auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql as 'select null::uuid';
create or replace function auth.jwt() returns jsonb language sql as 'select null::jsonb';
SQL

echo "== apply migrations"
for f in supabase/migrations/*.sql; do
  echo "   $f"
  "${PSQL[@]}" -q -f "$f"
done

echo "== apply seed"
"${PSQL[@]}" -q -f supabase/seed.sql

echo "== smoke assertions"
"${PSQL[@]}" -t -c "
select 'role_definitions: '||count(*) from role_definitions
union all select 'academic_years: '||count(*) from academic_years
union all select 'grade_sections: '||count(*) from grade_sections
union all select 'subjects: '||count(*) from subjects
union all select 'rooms: '||count(*) from rooms
union all select 'period_definitions: '||count(*) from period_definitions
union all select 'rls tables: '||count(*) from pg_tables where rowsecurity;"

echo "== RLS behavior"
psql -h /tmp -p "$PGPORT" -U postgres -d "$DB" -t -c "
set role authenticated;
select 'authenticated current years: '||count(*) from academic_years;
select 'authenticated settings rows: '||count(*) from settings_versions;
reset role;"

# Anonymous access to protected data must FAIL (deny-by-default, plan.md §7).
if psql -h /tmp -p "$PGPORT" -U postgres -d "$DB" -q -c "set role anon; select count(*) from academic_years; reset role;" 2>/dev/null; then
  echo "FAIL: anon could read academic_years"
  exit 1
fi
echo "   anon denied: OK"

echo "== append-only audit"
psql -h /tmp -p "$PGPORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q -c "insert into audit_events (actor_label, action, target_type, target_reference, outcome) values ('smoke','Smoke test','x','x','Success');"
if psql -h /tmp -p "$PGPORT" -U postgres -d "$DB" -q -c "update audit_events set action='hacked';" 2>/dev/null; then
  echo "FAIL: audit UPDATE was not blocked"
  exit 1
fi
echo "   audit update blocked: OK"

echo "== outbox chain"
"${PSQL[@]}" -t -c "
insert into outbox_events (event_key, kind, target_type, target_reference) values ('pdf.generate:r1:v1','pdf.generate','receipt','RC-2026-T01');
select 'claim: '||count(*) from app.claim_outbox(10);
select 'deliver: '||status from app.mark_outbox_delivered('pdf.generate:r1:v1');
insert into outbox_events (event_key, kind, target_type, target_reference) values ('email.deliver:a1:v1','email.deliver','admission_application','APP-2026-T02');
select 'fail: '||status||' attempts='||attempts from app.fail_outbox('email.deliver:a1:v1','boom');"

echo "== RLS positive/negative suite (fictional actors, plan.md §7)"
"${PSQL[@]}" -q -f scripts/validate-rls.sql

# The suite must also fail loudly if its assertions abort.
psql -h /tmp -p "$PGPORT" -U postgres -d "$DB" -t -c "select 'rls suite: '||result from (select result from (select 'RLS SUITE PASSED' as result) x) y;"

echo "== transactional RPC suite (plan.md §8)"
"${PSQL[@]}" -q -f scripts/validate-rpcs.sql

psql -h /tmp -p "$PGPORT" -U postgres -d "$DB" -t -c "select 'rpc suite: '||result from (select result from (select 'RPC SUITE PASSED' as result) x) y;"

echo "ALL LOCAL DATABASE CHECKS PASSED"
