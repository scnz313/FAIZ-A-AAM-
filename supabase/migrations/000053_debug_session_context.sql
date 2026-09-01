create or replace function app.debug_session_context()
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('session_user', session_user, 'current_user', current_user, 'jwt_role', auth.jwt() ->> 'role', 'uid', auth.uid());
$$;
grant execute on function app.debug_session_context() to service_role, authenticated;
