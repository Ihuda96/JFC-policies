-- JFC Policies Platform — V9: allow replacing an already-uploaded stamped PDF
--
-- Run once in the Supabase SQL Editor. Safe to re-run.
--
-- The stamped-PDF upload was switched from upsert:true to a plain insert
-- (see the code comment in ExecutivePage.tsx) to sidestep a Supabase
-- Storage bug where its INSERT ... ON CONFLICT DO UPDATE query path was
-- rejecting a correctly authenticated request. The fallback for a
-- re-approval — remove the old file, then insert fresh — needs a DELETE
-- policy on storage.objects that was never added, because the previous
-- upsert-based flow never needed one. Without it, "resource already
-- exists" errors on a second approval attempt for the same policy version
-- can't self-heal: the remove() call silently fails RLS, so the retry
-- insert hits the exact same conflict.

begin;

drop policy if exists "policy_storage_delete_own_folder" on storage.objects;
create policy "policy_storage_delete_own_folder"
on storage.objects for delete to authenticated
using (
  bucket_id in ('policy-originals', 'policy-previews', 'policy-approved')
  and (storage.foldername(name))[1] = auth.uid()::text
);

select pg_notify('pgrst', 'reload schema');

commit;
