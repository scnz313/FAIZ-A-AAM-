-- =============================================================================
-- 000021 — private document buckets
--
-- Storage is optional in the scratch PostgreSQL validator, so this migration
-- applies bucket/policy DDL only when Supabase's storage schema is present.
-- Application routes use the server-admin client to issue short-lived signed
-- URLs after checking the owning domain record; direct client storage access
-- remains denied by default.
-- =============================================================================

do $$
begin
  if to_regnamespace('storage') is null then
    raise notice 'storage schema not present; skipping bucket setup';
    return;
  end if;

  insert into storage.buckets (id, name, public)
  values
    ('fass-private-documents', 'fass-private-documents', false),
    ('fass-generated-documents', 'fass-generated-documents', false)
  on conflict (id) do update set public = false;

  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'fass_private_objects_no_direct_select') then
    create policy fass_private_objects_no_direct_select on storage.objects
      for select to anon, authenticated using (false);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'fass_private_objects_no_direct_insert') then
    create policy fass_private_objects_no_direct_insert on storage.objects
      for insert to anon, authenticated with check (false);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'fass_private_objects_no_direct_update') then
    create policy fass_private_objects_no_direct_update on storage.objects
      for update to anon, authenticated using (false) with check (false);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'fass_private_objects_no_direct_delete') then
    create policy fass_private_objects_no_direct_delete on storage.objects
      for delete to anon, authenticated using (false);
  end if;
end;
$$;
