-- Browser clients must never receive private Storage object keys. Downloads
-- are signed by the authenticated application route after server authorization.
begin;
revoke all on function app.data_export_create_signed_download(text,uuid) from public, anon, authenticated;
grant execute on function app.data_export_create_signed_download(text,uuid) to service_role;
commit;
