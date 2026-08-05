-- JFC Policies Platform — V11: keep one stamped-PDF row per policy
--
-- Run once in the Supabase SQL Editor. Safe to re-run.
--
-- The stamped-PDF upload now writes to a unique, timestamped filename on
-- every attempt (approved-stamped-<timestamp>.pdf) instead of a fixed
-- path, to avoid colliding with orphaned objects a failed earlier attempt
-- could leave behind. That means record_approved_pdf()'s old
-- "on conflict (bucket_id, storage_path) do update" no longer catches
-- re-approvals — the path is different every time, so it always inserts a
-- new row instead of updating the previous one, silently leaving old
-- approved_pdf rows (pointing at now stamp-outdated files) behind. Delete
-- any existing approved_pdf row(s) for the policy before inserting the new
-- one, so there is always exactly one.

begin;

create or replace function public.record_approved_pdf(
  p_policy_id uuid,
  p_version_id uuid,
  p_storage_path text,
  p_file_name text,
  p_file_size bigint
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_policy public.policies%rowtype;
  v_file_id uuid;
begin
  if auth.uid() is null or not public.is_ceo() then
    raise exception 'executive role is required';
  end if;

  select * into v_policy from public.policies where id = p_policy_id;
  if not found then
    raise exception 'policy not found';
  end if;

  if v_policy.final_approved_at is null then
    raise exception 'policy has not received final approval yet';
  end if;

  if not exists (
    select 1 from public.policy_versions
    where id = p_version_id and policy_id = p_policy_id
  ) then
    raise exception 'version does not belong to policy';
  end if;

  delete from public.policy_files
  where policy_id = p_policy_id
    and file_kind = 'approved_pdf'
    and storage_path <> p_storage_path;

  insert into public.policy_files (
    policy_id, version_id, bucket_id, storage_path, file_kind,
    file_name, content_type, file_size, created_by
  )
  values (
    p_policy_id, p_version_id, 'policy-approved', p_storage_path, 'approved_pdf',
    p_file_name, 'application/pdf', greatest(p_file_size, 1), auth.uid()
  )
  on conflict (bucket_id, storage_path) do update
  set file_size = excluded.file_size,
      file_name = excluded.file_name
  returning id into v_file_id;

  return v_file_id;
end;
$$;

grant execute on function public.record_approved_pdf(uuid, uuid, text, text, bigint) to authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
