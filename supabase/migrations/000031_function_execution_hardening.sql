begin;

revoke execute on all functions in schema app from public, anon;
alter default privileges for role postgres in schema app revoke execute on functions from public;

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end
$$;

grant execute on function app.public_notice_ids() to anon, authenticated;
grant execute on function app.admission_public_configuration(uuid) to anon, authenticated;
grant execute on function app.support_public_intake_v2(text,text,text,text,text,text,text,timestamptz) to anon, authenticated;
grant execute on function app.new_ref(text,int) to service_role;

commit;
