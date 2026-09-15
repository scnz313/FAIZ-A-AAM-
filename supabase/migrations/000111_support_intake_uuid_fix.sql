-- =============================================================================
-- 000111 — Public support intake: uuid column received a text expression
--
-- Verified live defect (15 September 2026): `app.support_public_intake_v2`
-- inserts the initial requester message with
--   `nullif(auth.uid()::text,'')`
-- into `public.support_messages.author_account_id`, which is `uuid` (made
-- nullable by 000029). Because the expression's type is `text`, PostgreSQL
-- rejects every public submission with
--   `column "author_account_id" is of type uuid but expression is of type text`
-- even when the value is null, so the public concern form could never succeed.
--
-- The column is nullable for exactly this case (an anonymous requester), so
-- the correct value is `auth.uid()` itself: null for anonymous intake and the
-- authenticated account otherwise. Nothing else in the function changes:
-- category/subject/body/contact validation, CAPTCHA-field requirement, the
-- intake-hash rate limit, the `support_events` row, the conditional audit
-- entry, and the return shape stay byte-identical.
--
-- Grants are restated as left by 000087 (service_role only; the Next.js
-- server route holds the secret key and never exposes the command). Forward
-- from 000110. Validated and applied by the central process.
-- =============================================================================

begin;

create or replace function app.support_public_intake_v2(
  p_category text,p_subject text,p_body text,p_contact text,p_requester_name text default null,
  p_intake_key_hash text default null,p_captcha_provider text default null,p_captcha_verified_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_request public.support_requests%rowtype; v_message public.support_messages%rowtype;
begin
  if length(btrim(coalesce(p_subject,'')))<1 or length(btrim(coalesce(p_body,'')))<1 then raise exception 'support subject and message are required'; end if;
  if length(btrim(coalesce(p_contact,'')))<5 then raise exception 'a safe contact is required'; end if;
  if p_captcha_verified_at is null or p_captcha_provider is null or length(btrim(p_captcha_provider))=0 then raise exception 'captcha verification is required'; end if;
  if p_intake_key_hash is not null and (select count(*) from public.support_requests where intake_key_hash=p_intake_key_hash and created_at>now()-interval '1 hour')>=5 then raise exception 'public support rate limit reached'; end if;
  insert into public.support_requests(requester_account_id,requester_name,requester_contact,public_intake_key,intake_key_hash,captcha_provider,captcha_verified_at,category,subject)
  values(auth.uid(),nullif(btrim(p_requester_name),''),btrim(p_contact),null,p_intake_key_hash,p_captcha_provider,p_captcha_verified_at,btrim(p_category),btrim(p_subject)) returning * into v_request;
  insert into public.support_messages(support_request_id,author_account_id,author_label,body,is_staff,visibility) values(v_request.id,auth.uid(),coalesce(nullif(btrim(p_requester_name),''),'Public requester'),btrim(p_body),false,'requester') returning * into v_message;
  insert into public.support_events(support_request_id,event_type,detail) values(v_request.id,'public_intake','initial requester message');
  if auth.uid() is not null then
    perform app.record_audit('Public support intake','support_request',v_request.reference,'Success');
  end if;
  return jsonb_build_object('id',v_request.id,'reference',v_request.reference,'status',v_request.status,'version',v_request.version);
end;
$$;

revoke all on function app.support_public_intake_v2(text, text, text, text, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function app.support_public_intake_v2(text, text, text, text, text, text, text, timestamptz)
  to service_role;

commit;
