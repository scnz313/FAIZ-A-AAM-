-- =============================================================================
-- 000119 — Guardian link requests: own-row reference projection
--
-- Defect (verified live on staging): after a guardian submits a link request,
-- the pending queue on `/portal/link-child` rendered "Unnamed student" and hid
-- the student reference. `links.listMine` embedded `students(...)` through the
-- caller's RLS client, and a pending link's student is invisible under
-- `scope_guardian_students` (which requires `guardian_has_capability`, i.e. an
-- active link). The embed therefore returned null even though the guardian had
-- typed the reference that `app.student_reference_lookup` (000099) resolved at
-- request time.
--
-- `app.guardian_links_mine()` is a definer projection over the caller's own
-- `guardian_student_links` rows (any status). It returns the link's own
-- summary fields plus the requested student's public reference and display
-- name, and nothing else: no enrollment, no sibling/guardian data, no other
-- family records. The caller resolves through their active guardian account,
-- mirroring the 000099 gate. Capabilities stay limited to active links,
-- exactly the pre-existing RLS visibility.
--
-- Forward-only from 000118. Never edit migrations 000001–000118. This file is
-- validated and applied by the central process; the implementing agent does
-- not apply it remotely.
-- =============================================================================

begin;

create or replace function app.guardian_links_mine()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', l.id,
        'reference', l.reference,
        'guardian_id', l.guardian_id,
        'student_id', l.student_id,
        'relationship_label', l.relationship_label,
        'status', l.status,
        'verification_source', l.verification_source,
        'approved_at', l.approved_at,
        'effective_from', l.effective_from,
        'effective_to', l.effective_to,
        'restriction_reason', l.restriction_reason,
        'rejection_reason', l.rejection_reason,
        'contact_priority', l.contact_priority,
        'is_emergency_contact', l.is_emergency_contact,
        'is_billing_contact', l.is_billing_contact,
        'version', l.version,
        'created_at', l.created_at,
        'guardian_name', coalesce(
          nullif(btrim(gp.display_name), ''),
          nullif(btrim(concat_ws(' ', nullif(btrim(gp.given_name), ''), nullif(btrim(gp.family_name), ''))), '')),
        'student_name', coalesce(
          nullif(btrim(sp.display_name), ''),
          nullif(btrim(concat_ws(' ', nullif(btrim(sp.given_name), ''), nullif(btrim(sp.family_name), ''))), '')),
        'student_reference', st.reference,
        'guardian_link_capabilities', coalesce((
          select jsonb_agg(jsonb_build_object('capability', c.capability) order by c.capability)
            from public.guardian_link_capabilities c
           where c.link_id = l.id
             and l.status = 'active'), '[]'::jsonb)
      )
      order by l.created_at desc, l.id asc
    ),
    '[]'::jsonb
  )
    from public.guardian_student_links l
    join public.guardians g on g.id = l.guardian_id
    join public.user_accounts ua on ua.person_id = g.person_id
    join public.students st on st.id = l.student_id
    join public.people sp on sp.id = st.person_id
    join public.people gp on gp.id = g.person_id
   where ua.id = auth.uid()
     and ua.status = 'active'
     and g.status = 'active'
$$;

revoke all on function app.guardian_links_mine() from public, anon;
grant execute on function app.guardian_links_mine() to authenticated, service_role;

commit;
