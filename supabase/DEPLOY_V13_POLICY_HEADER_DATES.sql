-- JFC Policies Platform — V13: actually persist the document's own dates
--
-- Run once in the Supabase SQL Editor. Safe to re-run.
--
-- The app already had a client-side parser (parsePolicyHeader in
-- documentCode.ts) that reads the exact "Issue Date / Effective Date /
-- Review Date" letterhead table every policy document carries — it was
-- just never wired to anything. Nothing ever called it on upload, and
-- nothing ever wrote its result into policy_metadata, so every policy's
-- issue_date/review_date stayed null and every card fell back to a
-- workflow timestamp instead — which is why the app showed dates that
-- didn't match the real document at all. There was also no "effective
-- date" column to begin with; policy_metadata only had approval_date,
-- which isn't the same field the document actually prints.
--
-- This adds the missing column and a SECURITY DEFINER RPC the client can
-- call right after parsing a file (policy_metadata's own write RLS is
-- quality_manager/system_admin-only, so an ordinary author uploading
-- their own draft can't write it directly).

begin;

alter table public.policy_metadata add column if not exists effective_date date;

-- Persists (or backfills) a policy's extracted header fields. Only
-- touches fields actually passed in — a partial re-extraction never blanks
-- out a field that was already known.
create or replace function public.upsert_policy_extracted_dates(
  p_policy_id uuid,
  p_issue_date date,
  p_effective_date date,
  p_review_date date,
  p_issuing_department text default null,
  p_extracted_title text default null,
  p_extracted_policy_number text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.can_access_policy_content(p_policy_id) then
    raise exception 'access to this policy is required';
  end if;

  insert into public.policy_metadata (
    policy_id, issue_date, effective_date, review_date,
    issuing_department, extracted_title, extracted_policy_number,
    extraction_status
  )
  values (
    p_policy_id, p_issue_date, p_effective_date, p_review_date,
    p_issuing_department, p_extracted_title, p_extracted_policy_number,
    'completed'
  )
  on conflict (policy_id) do update
  set issue_date = coalesce(excluded.issue_date, policy_metadata.issue_date),
      effective_date = coalesce(excluded.effective_date, policy_metadata.effective_date),
      review_date = coalesce(excluded.review_date, policy_metadata.review_date),
      issuing_department = coalesce(excluded.issuing_department, policy_metadata.issuing_department),
      extracted_title = coalesce(excluded.extracted_title, policy_metadata.extracted_title),
      extracted_policy_number = coalesce(excluded.extracted_policy_number, policy_metadata.extracted_policy_number),
      extraction_status = 'completed',
      updated_at = now();
end;
$$;

grant execute on function public.upsert_policy_extracted_dates(uuid, date, date, date, text, text, text) to authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
