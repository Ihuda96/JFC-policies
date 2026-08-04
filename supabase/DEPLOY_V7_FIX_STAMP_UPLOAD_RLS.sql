-- JFC Policies Platform — V7: fix "new row violates row-level security
-- policy" when the CEO's browser uploads a freshly stamped PDF
--
-- Run once in the Supabase SQL Editor. Safe to re-run.
--
-- Symptom: after final approval, the toast reads
--   تعذّر ختم نسخة PDF لسياسة "...": new row violates row-level security policy
-- with no "for table ..." suffix. That exact shape is the Storage API's own
-- error text, not a Postgres error surfaced through PostgREST — meaning the
-- rejected write is the browser's direct upload to the 'policy-approved'
-- bucket (supabase.storage.from('policy-approved').upload(...) in
-- ExecutivePage.tsx), not the record_approved_pdf() RPC that runs after it
-- (that RPC is SECURITY DEFINER and bypasses RLS already).
--
-- The insert/update policies below already exist in the repo's baseline
-- schema (202607160001_create_jfc_policies_platform.sql /
-- DEPLOY_TO_SUPABASE.sql) and *should* already permit this — a CEO
-- uploading to their own uid-prefixed folder. This file just re-asserts
-- them verbatim against the live project, in case an earlier partial or
-- out-of-order deploy left the live storage policies out of sync with what
-- the app now expects (the same class of drift fixed previously in
-- DEPLOY_ALL_ACCESS_FOR_ACCOUNT.sql / DEPLOY_ARCHIVE_POLICY_FIX.sql).

begin;

drop policy if exists "policy_storage_insert_own_folder" on storage.objects;
create policy "policy_storage_insert_own_folder"
on storage.objects for insert to authenticated
with check (
  bucket_id in ('policy-originals', 'policy-previews', 'policy-approved')
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "policy_storage_update_own_unapproved" on storage.objects;
create policy "policy_storage_update_own_unapproved"
on storage.objects for update to authenticated
using (
  bucket_id in ('policy-originals', 'policy-previews', 'policy-approved')
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id in ('policy-originals', 'policy-previews', 'policy-approved')
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "policy_storage_select_authorized" on storage.objects;
create policy "policy_storage_select_authorized"
on storage.objects for select to authenticated
using (
  bucket_id in ('policy-originals', 'policy-previews', 'policy-approved')
  and exists (
    select 1
    from public.policy_files pf
    where pf.bucket_id = storage.objects.bucket_id
      and pf.storage_path = storage.objects.name
      and public.can_access_policy_content(pf.policy_id)
  )
);

-- Re-assert the bucket itself: correct mime types, size limit, and public
-- read (needed for the QR-code section library to show the stamped PDF).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'policy-approved',
  'policy-approved',
  true,
  52428800,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
set public = true,
    file_size_limit = 52428800,
    allowed_mime_types = array[
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];

select pg_notify('pgrst', 'reload schema');

commit;
