-- JFC Policies Platform — V6: the CEO's stamp embedded in the actual PDF
--
-- Run once in the Supabase SQL Editor. Safe to re-run.
--
-- V5 (DEPLOY_V5_CEO_ESTAMP.sql) recorded the stamp on the policy row and
-- showed it as a UI seal. This step goes further: when the CEO approves a
-- policy, the browser downloads the original PDF, draws the CEO's e-stamp
-- onto it with pdf-lib, and uploads the result as a new file of kind
-- 'approved_pdf' (a column the schema already had reserved for exactly
-- this). record_approved_pdf() is the only way that file row gets
-- created — policy_files' insert RLS only covers owners and the quality
-- team, not the executive office, so this is done through a
-- SECURITY DEFINER function instead of widening that policy.
--
-- SECURITY NOTE: the section-barcode public library (anonymous, PIN-gated)
-- now also links to this stamped PDF, so the 'policy-approved' storage
-- bucket is made public here (previously private, like the other policy
-- buckets). Storage paths are UUID-based and not listable, so this trades
-- "only signed, short-lived URLs" for "unguessable but permanent URLs" —
-- appropriate for a document that's already meant to be shown to any
-- department employee scanning that section's QR code, but worth knowing
-- if that public exposure isn't what you want: the fix is
-- `update storage.buckets set public = false where id = 'policy-approved';`
-- plus dropping the approved_pdf_path column from open_section_library
-- below, which reverts the public library back to metadata-only.

begin;

update storage.buckets
set public = true
where id = 'policy-approved';

-- Registers a stamped PDF the CEO's browser just generated and uploaded.
-- Only the executive office can call this, and only for a policy that has
-- already actually received final approval.
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

-- Public section library: also point at the stamped PDF, if one exists for
-- the currently approved version. Changing a returns-table shape requires
-- dropping the function first.
drop function if exists public.open_section_library(text, text);
create or replace function public.open_section_library(p_code text, p_access_code text)
returns table (
  id uuid,
  title text,
  policy_number text,
  approved_at timestamptz,
  final_approved_at timestamptz,
  next_review_at date,
  department_code text,
  final_stamp_path text,
  approved_pdf_path text
)
language sql
stable
security definer
set search_path = public
as $$
  with target as (
    select code, parent_code
    from public.section_access
    where code = upper(trim(coalesce(p_code, '')))
      and is_active
      and access_code = trim(coalesce(p_access_code, ''))
  )
  select p.id,
         p.title,
         p.policy_number,
         p.approved_at,
         p.final_approved_at,
         p.next_review_at,
         public.policy_department_code(p.policy_number, p.owner_department) as department_code,
         p.final_stamp_path,
         (
           select pf.storage_path
           from public.policy_files pf
           where pf.policy_id = p.id
             and pf.version_id = p.approved_version_id
             and pf.file_kind = 'approved_pdf'
           order by pf.created_at desc
           limit 1
         ) as approved_pdf_path
  from public.policies p, target t
  where p.final_approved_at is not null
    and p.status = 'approved'
    and (
      public.policy_department_code(p.policy_number, p.owner_department) = t.code
      or upper(split_part(coalesce(p.policy_number, ''), '-', 3)) = t.code
    )
  order by p.final_approved_at desc
$$;

grant execute on function public.open_section_library(text, text) to anon, authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
