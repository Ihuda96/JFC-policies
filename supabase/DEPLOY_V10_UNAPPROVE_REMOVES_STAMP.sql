-- JFC Policies Platform — V10: unapproving also removes the stamped PDF
--
-- Run once in the Supabase SQL Editor. Safe to re-run. Requires
-- DEPLOY_V8_UNAPPROVE_ENUM.sql and DEPLOY_V8_CEO_UNAPPROVE.sql to already
-- be applied (this replaces that function).
--
-- ceo_unapprove_policy() previously only cleared final_approved_at and the
-- stamp reference on the policies row. The section-barcode public library
-- (open_section_library) already stops listing the policy at that point —
-- it filters on final_approved_at is not null — but the stamped PDF file
-- itself was left behind in storage and in policy_files, so a direct link
-- to it could still surface a document claiming to be "finally approved"
-- after the CEO explicitly took that approval back.
--
-- Supabase does not allow a direct SQL DELETE on storage.objects ("Direct
-- deletion from storage tables is not allowed. Use the Storage API
-- instead.") — deleting the underlying file has to go through the Storage
-- API, which only works client-side under the CEO's own authenticated
-- session (see the client-side removal added in ExecutivePage.tsx, which
-- runs before this RPC). This function only removes the policy_files
-- metadata row, an ordinary table with no such restriction.

begin;

create or replace function public.ceo_unapprove_policy(p_policy_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_policy public.policies%rowtype;
begin
  if v_actor is null or not public.is_ceo() then
    raise exception 'executive role is required';
  end if;

  select * into v_policy
  from public.policies
  where id = p_policy_id
  for update;

  if not found then
    raise exception 'policy not found';
  end if;

  if v_policy.final_approved_at is null then
    raise exception 'policy has not received final approval yet';
  end if;

  delete from public.policy_files
  where policy_id = p_policy_id
    and file_kind = 'approved_pdf';

  update public.policies
  set final_approved_at = null,
      final_approved_by = null,
      final_stamp_path = null,
      updated_at = now()
  where id = p_policy_id;

  insert into public.approval_actions (policy_id, version_id, actor_id, action, comment)
  values (
    p_policy_id,
    coalesce(v_policy.approved_version_id, v_policy.current_version_id),
    v_actor,
    'unapproved',
    null
  );

  perform public.log_audit(
    'policy_returned',
    'policies',
    p_policy_id,
    p_policy_id,
    jsonb_build_object('ceo_unapprove', true, 'stamped_pdf_removed', true)
  );
end;
$$;

grant execute on function public.ceo_unapprove_policy(uuid) to authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
