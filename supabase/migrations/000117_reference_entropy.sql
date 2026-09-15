-- =============================================================================
-- 000117 — Reference suffixes gain entropy: collision-safe bulk inserts
--
-- Verified defect (scale test, 15 September 2026): `app.new_ref` builds the
-- suffix from six hexadecimal characters (24 bits). The birthday collision
-- probability for a batch of n rows is about n²/2^25: a 3,000-row bulk insert
-- has a ~23% chance of at least one duplicate reference, and one was hit
-- building the 4,000-student scale fixture (`people_reference_key`). Bulk
-- CSV imports insert thousands of rows in one transaction, so this is a real
-- 4k-scale blocker.
--
-- The suffix widens to ten hexadecimal characters (40 bits): at 4,000 rows
-- the collision probability drops to ~1.5e-5, and even a 100,000-row year
-- stays under 0.5%. The shape `PREFIX-YYYY-XXXXXXXXXX` is otherwise
-- unchanged; existing references stay valid, and no code or test depends on
-- a six-character suffix (verified repo-wide). Function signature,
-- volatility, `search_path`, and grants are unchanged (the 000032 grant to
-- `authenticated` still applies because the signature did not change).
--
-- Forward-only from 000116. Validated and applied by the central process.
-- =============================================================================

begin;

create or replace function app.new_ref(prefix text, ref_year int default null)
returns text
language sql
volatile
set search_path = ''
as $$
  select upper(prefix) || '-' || coalesce(ref_year, extract(year from now())::int)::text || '-' ||
         upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
$$;

comment on function app.new_ref(text, int) is
  'Human-readable reference: PREFIX-YEAR-XXXXXXXXXX with a 40-bit hex suffix (000117; six characters before).';

commit;
