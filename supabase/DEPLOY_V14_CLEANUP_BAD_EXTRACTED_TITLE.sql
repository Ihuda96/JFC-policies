-- JFC Policies Platform — V14: clean up a bad extracted_title/number
--
-- Run once in the Supabase SQL Editor. Safe to re-run.
--
-- V13's client code briefly also wrote extracted_title/extracted_policy_number
-- alongside the (correct) letterhead dates. Their label-boundary parsing
-- isn't reliable — a labelled field with no other recognized label
-- following it in the document text captures everything up to the next
-- match, which can be the rest of the whole document — so a policy's
-- extracted_title could end up holding a huge block of body text instead
-- of a short title. The Library page prefers extracted_title over the
-- policy's real (correctly set) title when present, so this showed up as
-- a policy's name changing to a wall of contract text.
--
-- The application code no longer writes these two fields at all (only the
-- three dates). This just clears whatever got corrupted in that window —
-- a real title is always short, so anything implausibly long is the bug,
-- not genuine data.

begin;

update public.policy_metadata
set extracted_title = null
where extracted_title is not null
  and length(extracted_title) > 200;

update public.policy_metadata
set extracted_policy_number = null
where extracted_policy_number is not null
  and length(extracted_policy_number) > 100;

commit;
