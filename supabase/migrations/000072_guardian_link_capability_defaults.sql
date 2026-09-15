-- ---------------------------------------------------------------------------
-- 000072 — guardian link capability defaults
--
-- Every portal module (academics/results, finance, documents, notices,
-- profile) is gated by app.guardian_has_capability(), which joins
-- guardian_link_capabilities. Link approval, enrollment conversion, and
-- claim activation all create or activate a guardian_student_links row but
-- never inserted capabilities, so a freshly converted child appeared in the
-- portal while every module denied access. This migration seeds the five
-- standard capabilities whenever a link becomes active (and backfills
-- existing active links). Staff can still narrow them later through
-- app.links_capabilities_set, which replaces the set explicitly.
-- ---------------------------------------------------------------------------

create or replace function app.guardian_link_capabilities_default()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active'
     and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    insert into public.guardian_link_capabilities (link_id, capability)
    select new.id, capability
      from unnest(array['academics', 'finance', 'documents', 'notices', 'profile']) capability
    on conflict (link_id, capability) do nothing;
  end if;
  return new;
end
$$;

drop trigger if exists guardian_link_capabilities_default on public.guardian_student_links;
create trigger guardian_link_capabilities_default
  after insert or update of status on public.guardian_student_links
  for each row execute function app.guardian_link_capabilities_default();

-- Backfill: active links created before this migration (approvals,
-- conversions, activations) get the same standard set.
insert into public.guardian_link_capabilities (link_id, capability)
select l.id, capability
  from public.guardian_student_links l
  cross join unnest(array['academics', 'finance', 'documents', 'notices', 'profile']) capability
 where l.status = 'active'
on conflict (link_id, capability) do nothing;

revoke all on function app.guardian_link_capabilities_default() from public;
