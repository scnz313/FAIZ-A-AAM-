-- =============================================================================
-- 000102 — Anonymous public document delivery can record its audit evidence
--
-- `app.record_audit` (000001, extended by 000054) accepts a service session
-- with an explicit actor label, but EXECUTE was granted only to
-- `authenticated`. The anonymous public-download boundary in
-- `/api/documents/[ref]` signs the storage URL and then records
-- 'Public document download URL issued' through the service-role client; that
-- call fails with `42501 permission denied for function record_audit`, so the
-- route refuses delivery with 503 for every approved public document. The
-- worker and the route comment already assume a service-role audit path;
-- this restores the intended grant.
--
-- Forward-only, grants only: no signature, policy, data, or behavior change.
-- Apply after 000101; remote application remains owner-gated.
-- =============================================================================

begin;

grant execute on function app.record_audit(text, text, text, text, text, text) to service_role;

commit;
