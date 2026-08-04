-- JFC Policies Platform — V8 (2 of 2): CEO "unapprove" action
--
-- Run DEPLOY_V8_UNAPPROVE_ENUM.sql FIRST, then this file, both in the
-- Supabase SQL Editor. Safe to re-run.
--
-- Lets the CEO undo their own final approval and put the policy straight
-- back into the executive queue ("سياسة بانتظار الاعتماد"), without sending
-- it back to the author for revision — that's what ceo_return_policy is
-- for, and it also re-opens the version for editing. This action leaves
-- the quality team's approval (status = 'approved') untouched; only the
-- executive office's own final sign-off is reversed, exactly mirroring
-- what ceo_final_approve set.

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
    jsonb_build_object('ceo_unapprove', true)
  );
end;
$$;

grant execute on function public.ceo_unapprove_policy(uuid) to authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
