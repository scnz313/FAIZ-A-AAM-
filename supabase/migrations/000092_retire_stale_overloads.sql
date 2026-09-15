-- 000092 — Retire stale SECURITY DEFINER overloads.
--
-- Later migrations replaced these commands with extended signatures that
-- carry defaults, but the original overloads were never dropped. Postgres
-- then cannot choose a candidate for a short-argument call
-- (`42725 function is not unique`), which broke the protected export
-- request and would break the claim-accept call the same way.

begin;

drop function if exists app.data_export_request(text, jsonb, jsonb, text, text, text);
drop function if exists app.guardian_claim_accept(text, text, text);

commit;
