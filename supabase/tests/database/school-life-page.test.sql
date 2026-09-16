-- =============================================================================
-- 000125 page-sections body + publisher page drafting assertions.
--
-- Locks the contract for the managed /school-life page on the local scratch
-- instance:
--   * anonymous sessions can never execute the content functions;
--   * a structured page-sections body is accepted by content_validate_body
--     and content_save_draft_v2, and malformed section bodies are refused;
--   * a content_publisher may draft a page but is still refused for notices;
--   * a publisher-authored page draft can be sent for review by its author
--     (the pre-000125 guard deadlocked that path), while a non-author editor
--     is still refused;
--   * approve/publish stay publisher-only and refuse the authoring publisher.
-- Run by scripts/validate-db-local.sh.
-- =============================================================================

\set ON_ERROR_STOP on

create or replace function auth.uid() returns uuid language sql as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

begin;

insert into auth.users (id) values
  ('10000000-0000-4000-8000-000000000401'),
  ('10000000-0000-4000-8000-000000000402'),
  ('10000000-0000-4000-8000-000000000403'),
  ('10000000-0000-4000-8000-000000000404');

insert into public.people (id, given_name, family_name, display_name) values
  ('20000000-0000-4000-8000-000000000401', 'Page', 'Editor', 'Page Editor'),
  ('20000000-0000-4000-8000-000000000402', 'Page', 'Publisher', 'Page Publisher'),
  ('20000000-0000-4000-8000-000000000403', 'Other', 'Editor', 'Other Editor'),
  ('20000000-0000-4000-8000-000000000404', 'Plain', 'User', 'Plain User');

insert into public.user_accounts (id, person_id, status, verified_contact) values
  ('10000000-0000-4000-8000-000000000401', '20000000-0000-4000-8000-000000000401', 'active', 'page.editor@example.test'),
  ('10000000-0000-4000-8000-000000000402', '20000000-0000-4000-8000-000000000402', 'active', 'page.publisher@example.test'),
  ('10000000-0000-4000-8000-000000000403', '20000000-0000-4000-8000-000000000403', 'active', 'other.editor@example.test'),
  ('10000000-0000-4000-8000-000000000404', '20000000-0000-4000-8000-000000000404', 'active', 'plain.user@example.test');

insert into public.role_grants (account_id, role_code, status, effective_from) values
  ('10000000-0000-4000-8000-000000000401', 'content_editor', 'active', now()),
  ('10000000-0000-4000-8000-000000000402', 'content_publisher', 'active', now()),
  ('10000000-0000-4000-8000-000000000403', 'content_editor', 'active', now()),
  ('10000000-0000-4000-8000-000000000403', 'content_publisher', 'active', now());

-- ---------------------------------------------------------------------------
-- Privilege boundary: anon never executes, authenticated does.
-- ---------------------------------------------------------------------------
do $$
begin
  assert not has_function_privilege('anon', 'app.content_save_draft_v2(uuid,text,text,text,jsonb,integer,text)', 'EXECUTE'),
    'anonymous callers must never save drafts';
  assert not has_function_privilege('anon', 'app.content_request_review(uuid,integer,text)', 'EXECUTE'),
    'anonymous callers must never request review';
  assert has_function_privilege('authenticated', 'app.content_save_draft_v2(uuid,text,text,text,jsonb,integer,text)', 'EXECUTE'),
    'authenticated staff execute the draft save';
end
$$;

-- ---------------------------------------------------------------------------
-- Validation: the structured page body passes; malformed shapes are refused.
-- ---------------------------------------------------------------------------
do $$
declare v_body jsonb;
begin
  v_body := '{
    "schemaVersion": 1, "page": "school-life",
    "intro": {"eyebrow": "School life", "title": "Life at the school", "deck": "A week of work and play."},
    "programmes": [{"id": "p1", "icon": "sports_cricket", "title": "Sports", "line": "Cricket and football."}],
    "facilities": [{"id": "f1", "title": "Library", "line": "A reading room."}],
    "gallery": [{"id": "g1", "art": "read", "caption": "Reading hour"}],
    "note": ""
  }'::jsonb;
  assert app.content_validate_body(v_body) = v_body, 'a valid page-sections body must validate';

  declare v_denied boolean := false;
  begin
    begin perform app.content_validate_body(v_body - 'gallery');
    exception when others then v_denied := true; end;
    assert v_denied, 'a page body without a gallery array must be refused';

    v_denied := false;
    begin perform app.content_validate_body(jsonb_set(v_body, '{programmes}', '[]'::jsonb));
    exception when others then v_denied := true; end;
    assert v_denied, 'an empty programmes array must be refused';

    v_denied := false;
    begin perform app.content_validate_body(jsonb_set(v_body, '{facilities,0}', '{"id":"f1","title":"","line":""}'::jsonb));
    exception when others then v_denied := true; end;
    assert v_denied, 'a facility without a title must be refused';

    v_denied := false;
    begin perform app.content_validate_body('{"schemaVersion":1,"page":"school-life","intro":{"title":"x"},"programmes":[],"facilities":[],"gallery":[]}'::jsonb - 'page');
    exception when others then v_denied := true; end;
    assert v_denied, 'a partial page shape without the page marker falls through to blocks and is refused';
  end;
end
$$;

-- ---------------------------------------------------------------------------
-- Publisher drafts a page; the same account is refused for notices.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000402', true);
select set_config('request.jwt.claims', '{"role":"authenticated","aal":"aal2"}', true);
do $$
declare
  v_result jsonb;
  v_denied boolean := false;
  v_item_id uuid;
begin
  v_result := app.content_save_draft_v2(
    null, 'page', 'school-life', 'School life',
    '{
      "schemaVersion": 1, "page": "school-life",
      "intro": {"eyebrow": "School life", "title": "Play is on the timetable", "deck": "Sports, art and service."},
      "programmes": [{"id": "p1", "icon": "sports_cricket", "title": "Sports", "line": "Cricket and football."}],
      "facilities": [{"id": "f1", "title": "Library", "line": "A reading room."}],
      "gallery": [{"id": "g1", "art": "read", "caption": "Reading hour"}],
      "note": ""
    }'::jsonb,
    null, 'page-draft-test-1');
  assert (v_result ->> 'version')::int = 1, 'the first page draft is version 1';
  v_item_id := (v_result ->> 'id')::uuid;

  /* Idempotent replay returns the same version without inserting again. */
  v_result := app.content_save_draft_v2(
    v_item_id, 'page', 'school-life', 'School life',
    '{"schemaVersion":1,"page":"school-life","intro":{"eyebrow":"x","title":"x","deck":"x"},"programmes":[{"id":"p","icon":"map","title":"t","line":"l"}],"facilities":[{"id":"f","title":"t","line":"l"}],"gallery":[{"id":"g","art":"lake","caption":"c"}],"note":""}'::jsonb,
    null, 'page-draft-test-1');
  assert (v_result ->> 'replayed')::boolean, 'the same idempotency key replays the saved draft';

  /* A publisher may not draft notices. */
  begin
    perform app.content_save_draft_v2(null, 'notice', 'test-notice', 'Test notice', '{"blocks":[{"type":"paragraph","text":"Body."}]}'::jsonb, null, null);
  exception when others then v_denied := true; end;
  assert v_denied, 'a content publisher must be refused for notice drafts';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- Publisher author sends the page draft for review; a non-author editor is
-- refused; approve/publish stay publisher-only with the self-approval rule.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000402', true);
select set_config('request.jwt.claims', '{"role":"authenticated","aal":"aal2"}', true);
do $$
declare
  v_item_id uuid;
  v_version_id uuid;
  v_result jsonb;
begin
  select id into v_item_id from public.content_items where slug = 'school-life';
  select id into v_version_id from public.content_versions where content_item_id = v_item_id and version = 1;
  v_result := app.content_request_review(v_version_id, 1, 'page-review-test-1');
  assert (v_result ->> 'status') = 'in_review', 'the publisher author can send their page draft for review';
  assert (v_result ->> 'version')::int = 2, 'review appends a new immutable version';

  /* The authoring publisher cannot approve their own version. */
  declare v_denied boolean := false;
  begin
    begin perform app.content_approve_version(v_version_id, null, null);
    exception when others then v_denied := true; end;
    assert v_denied, 'the authoring publisher cannot approve their own version';

    v_denied := false;
    begin perform app.content_publish_version_v2(v_version_id, null, null, null, null);
    exception when others then v_denied := true; end;
    assert v_denied, 'the authoring publisher cannot publish their own version';
  end;
end
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000403', true);
select set_config('request.jwt.claims', '{"role":"authenticated","aal":"aal2"}', true);
do $$
declare
  v_item_id uuid;
  v_version_id uuid;
  v_denied boolean := false;
begin
  select id into v_item_id from public.content_items where slug = 'school-life';
  select id into v_version_id from public.content_versions where content_item_id = v_item_id and version = 1;
  begin
    perform app.content_request_review(v_version_id, 1, 'page-review-test-2');
  exception when others then v_denied := true; end;
  assert v_denied, 'a non-author editor cannot request review of the publisher draft';
end
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000401', true);
select set_config('request.jwt.claims', '{"role":"authenticated","aal":"aal2"}', true);
do $$
declare
  v_item_id uuid;
  v_denied boolean := false;
begin
  select id into v_item_id from public.content_items where slug = 'school-life';
  /* The content editor cannot approve — approval is publisher work. */
  declare v_version_id uuid;
  begin
    select id into v_version_id from public.content_versions where content_item_id = v_item_id and version = 2;
    begin perform app.content_approve_version(v_version_id, 2, null);
    exception when others then v_denied := true; end;
    assert v_denied, 'an editor cannot approve a page version';
  end;
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 000126 public_page_body: the anonymous surface reads the latest published
-- version even while a newer draft exists.
-- ---------------------------------------------------------------------------

/* The second publisher approves and publishes the in-review version. */
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000403', true);
select set_config('request.jwt.claims', '{"role":"authenticated","aal":"aal2"}', true);
do $$
declare
  v_item_id uuid;
  v_version_id uuid;
  v_result jsonb;
begin
  select id into v_item_id from public.content_items where slug = 'school-life';
  select id into v_version_id from public.content_versions where content_item_id = v_item_id and version = 2;
  v_result := app.content_approve_version(v_version_id, null, 'page-approve-test-1');
  assert (v_result ->> 'status') = 'approved', 'the second publisher approves the page';
  v_result := app.content_publish_version_v2((v_result ->> 'id')::uuid, null, null, null, 'page-publish-test-1');
  assert (v_result ->> 'status') = 'published', 'the page publishes';
end
$$;
reset role;

/* The published body is readable; the raw item table stays invisible to anon. */
set local role anon;
do $$
declare v_payload jsonb;
begin
  assert has_function_privilege('anon', 'app.public_page_body(text)', 'EXECUTE'),
    'anonymous readers may resolve the published page body';
  v_payload := app.public_page_body('school-life');
  assert v_payload -> 'body' -> 'intro' ->> 'title' = 'Play is on the timetable',
    'the published page body is returned to anonymous readers';
  assert app.public_page_body('missing-slug') is null,
    'an unknown slug resolves to null';
end
$$;
reset role;

/* A newer draft leaves the published version reachable. */
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000402', true);
select set_config('request.jwt.claims', '{"role":"authenticated","aal":"aal2"}', true);
do $$
declare
  v_item_id uuid;
  v_result jsonb;
begin
  select id into v_item_id from public.content_items where slug = 'school-life';
  v_result := app.content_save_draft_v2(
    v_item_id, 'page', 'school-life', 'School life',
    '{"schemaVersion":1,"page":"school-life","intro":{"eyebrow":"x","title":"Newer draft title","deck":"x"},"programmes":[{"id":"p","icon":"map","title":"t","line":"l"}],"facilities":[{"id":"f","title":"t","line":"l"}],"gallery":[{"id":"g","art":"lake","caption":"c"}],"note":""}'::jsonb,
    4, 'page-draft-test-2');
  assert (select current_status from public.content_items where id = v_item_id) = 'draft',
    'the new draft moves the item back to draft status';
  assert app.public_page_body('school-life') -> 'body' -> 'intro' ->> 'title' = 'Play is on the timetable',
    'the previously published body stays public while a newer draft exists';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 000127 content_author_directory: scoped name resolution for version
-- authors — content staff may resolve names, outsiders may not.
-- ---------------------------------------------------------------------------
do $$
begin
  assert not has_function_privilege('anon', 'app.content_author_directory(uuid)', 'EXECUTE'),
    'anonymous callers must never resolve the author directory';
  assert has_function_privilege('authenticated', 'app.content_author_directory(uuid)', 'EXECUTE'),
    'authenticated staff may resolve the author directory';
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000401', true);
select set_config('request.jwt.claims', '{"role":"authenticated","aal":"aal2"}', true);
do $$
declare
  v_item_id uuid;
  v_names text[];
begin
  select id into v_item_id from public.content_items where slug = 'school-life';
  select array_agg(entry ->> 'displayName') into v_names
    from app.content_author_directory(v_item_id) entry;
  assert 'Page Publisher' = any(v_names),
    'the editor resolves the publisher author name through the directory';
end
$$;
reset role;

/* An authenticated account without content scope is refused. */
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000404', true);
select set_config('request.jwt.claims', '{"role":"authenticated","aal":"aal2"}', true);
do $$
declare
  v_item_id uuid;
  v_denied boolean := false;
begin
  select id into v_item_id from public.content_items where slug = 'school-life';
  begin
    perform app.content_author_directory(v_item_id);
  exception when others then v_denied := true; end;
  assert v_denied, 'a staff-less account must be refused the author directory';
end
$$;
reset role;

select 'SCHOOL LIFE PAGE PASSED' as result;

rollback;
