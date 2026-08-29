# C5.8 Backup and Restore Rehearsal Record

**Date:** 2026-08-29
**Environment:** Supabase staging (jxegiamjcawdywqyutdz)
**Operator:** C5 staging agent
**Status:** PARTIAL — backup mechanism verified, restore rehearsal blocked by Docker requirement

## Backup Mechanism

- **Platform:** Supabase managed PostgreSQL (West EU / eu-west-1)
- **WALG backups:** Enabled (visible in `supabase backups list`)
- **PITR (Point-in-Time Recovery):** Not enabled (requires Supabase Pro plan)
- **Earliest backup timestamp:** 0 (no backups captured yet — project is newly created)
- **Local dump:** `supabase db dump --linked` requires Docker Desktop, which is not available in this environment

## Verified Database State (via `supabase db query --linked`)

### Migration History
- 33 migrations applied (000001–000033)
- Latest: `000033_anon_app_schema_usage`
- All migrations recorded in `supabase_migrations.schema_migrations`

### Critical Table Row Counts
| Table | Rows |
|-------|------|
| admission_applications | 32 |
| audit_events | 230 |
| documents | 2 |
| invoices | 20 |
| notification_deliveries | 57 |
| outbox_events | 129 |
| payments | 20 |
| people | 116 |
| role_grants | 185 |
| user_accounts | 107 |

### RLS Verification
- All 125 public-schema tables have RLS enabled (zero exceptions)
- Both storage buckets (`fass-private-documents`, `fass-generated-documents`) are private

## Restore Procedure (Documented)

1. **Platform-level restore:** Use Supabase dashboard → Database → Backups to restore from WALG backup (when available)
2. **Manual dump/restore:** Requires Docker Desktop for `supabase db dump --linked`:
   ```bash
   supabase db dump --linked --file backup.sql
   supabase db restore --linked --file backup.sql
   ```
3. **Direct pg_dump:** Requires database password (not available in this session):
   ```bash
   pg_dump "postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres" --schema=public --schema=app --file backup.sql
   ```

## RPO/RTO Estimates

- **RPO (Recovery Point Objective):** Up to 24 hours (WALG daily backups when available); 0 with PITR (not currently enabled)
- **RTO (Recovery Time Objective):** 30–60 minutes for platform-level restore; longer for manual dump/restore

## Blockers

1. **Docker required for `supabase db dump --linked`:** The Supabase CLI uses Docker to run pg_dump against the linked database. Without Docker, no local dump file can be created.
2. **No database password:** The `DATABASE_URL` in `.env.local` is empty, preventing direct `pg_dump` via the connection pooler.
3. **No PITR:** The project is on the free tier without Point-in-Time Recovery.
4. **No isolated restore target:** A second Supabase project or local Postgres is needed for a full restore rehearsal.

## Forward-Fix Procedure

1. Obtain the database password from the Supabase dashboard (Settings → Database)
2. Set `DATABASE_URL` in `.env.local` to the connection pooler URL
3. Run `pg_dump` directly (bypassing Docker) to create a verified dump file
4. Create a second Supabase project as an isolated restore target
5. Restore the dump into the isolated target and verify migration history, row counts, RLS, and private-object integrity
6. Enable PITR on the staging project for sub-hour RPO
