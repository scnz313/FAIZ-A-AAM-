-- Grant USAGE on the app schema to anon so the three intentional public RPCs
-- (public_notice_ids, admission_public_configuration, support_public_intake_v2)
-- can be invoked by unauthenticated visitors.  EXECUTE is still restricted to
-- those functions only by migration 000031; all other app-schema functions
-- remain anon-inaccessible.  RLS continues to protect all underlying tables.

grant usage on schema app to anon;
