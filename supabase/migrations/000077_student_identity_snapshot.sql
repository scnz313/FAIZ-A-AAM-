-- ---------------------------------------------------------------------------
-- 000077 — copy the submitted identity snapshot onto the permanent student
--
-- enrollment_convert creates the people and students rows but never carried
-- the submitted date of birth or gender onto students. The latest submitted
-- admission_application_versions snapshot is authoritative, so an AFTER
-- INSERT trigger on enrollment_conversions enriches the student once the
-- conversion row exists — on both the fresh-create and matched-existing
-- branches, filling only fields that are still null so the school record
-- stays authoritative. A malformed snapshot must never abort a conversion,
-- so the DOB is cast only when it matches a strict ISO date and any residual
-- cast error is swallowed. Existing converted students are backfilled the
-- same way.
-- ---------------------------------------------------------------------------

alter table public.students add column if not exists date_of_birth date;
alter table public.students add column if not exists gender text;

create or replace function app.enrollment_conversion_enrich_student()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_snapshot jsonb;
  v_dob_text text;
  v_dob date;
  v_gender text;
begin
  select av.snapshot into v_snapshot
    from public.admission_application_versions av
   where av.application_id = new.application_id
   order by av.version desc
   limit 1;
  if v_snapshot is null then return new; end if;

  v_dob_text := nullif(btrim(coalesce(v_snapshot ->> 'dob', '')), '');
  if v_dob_text ~ '^\d{4}-\d{2}-\d{2}$' then
    begin
      v_dob := v_dob_text::date;
    exception when others then
      v_dob := null;
    end;
  end if;
  v_gender := nullif(btrim(coalesce(v_snapshot ->> 'gender', '')), '');

  if v_dob is not null or v_gender is not null then
    /* Fill only: an existing record's identity is never overwritten by a
       later application snapshot (the matched branch keeps the school record
       authoritative). */
    update public.students
       set date_of_birth = coalesce(date_of_birth, v_dob),
           gender = coalesce(gender, v_gender)
     where id = new.student_id;
  end if;
  return new;
end
$$;

drop trigger if exists enrollment_conversions_enrich_student on public.enrollment_conversions;
create trigger enrollment_conversions_enrich_student
  after insert on public.enrollment_conversions
  for each row execute function app.enrollment_conversion_enrich_student();

-- Backfill: converted students that still lack a date of birth take the latest
-- submitted snapshot for their application. Parsing failures skip the row.
do $$
declare
  v_row record;
  v_dob date;
  v_gender text;
begin
  for v_row in
    select s.id as student_id,
           (select av.snapshot
              from public.admission_application_versions av
             where av.application_id = ec.application_id
             order by av.version desc
             limit 1) as snapshot
      from public.enrollment_conversions ec
      join public.students s on s.id = ec.student_id
     where s.date_of_birth is null
  loop
    continue when v_row.snapshot is null;
    v_dob := null;
    if nullif(btrim(coalesce(v_row.snapshot ->> 'dob', '')), '') ~ '^\d{4}-\d{2}-\d{2}$' then
      begin
        v_dob := btrim(v_row.snapshot ->> 'dob')::date;
      exception when others then
        v_dob := null;
      end;
    end if;
    v_gender := nullif(btrim(coalesce(v_row.snapshot ->> 'gender', '')), '');
    if v_dob is not null or v_gender is not null then
      update public.students
         set date_of_birth = coalesce(v_dob, date_of_birth),
             gender = coalesce(v_gender, gender)
       where id = v_row.student_id;
    end if;
  end loop;
end $$;

revoke all on function app.enrollment_conversion_enrich_student() from public;
