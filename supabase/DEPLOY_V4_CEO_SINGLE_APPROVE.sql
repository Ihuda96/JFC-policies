-- JFC Policies Platform — V4: single-policy final approval
--
-- Run once in the Supabase SQL Editor. Safe to re-run.
--
-- The executive queue only had "اعتماد الكل" (approve everything waiting)
-- via ceo_final_approve_all. There was no way to finalise the one policy
-- the CEO just reviewed without approving the whole queue alongside it —
-- forcing a detour back to the bulk action for a single-item decision.
-- This adds the missing single-policy counterpart.

begin;

create or replace function public.ceo_final_approve(p_policy_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_policy public.policies;
begin
  if v_actor is null or not public.is_ceo() then
    raise exception 'executive role is required';
  end if;

  select * into v_policy from public.policies where id = p_policy_id for update;
  if not found then
    raise exception 'policy not found';
  end if;

  if v_policy.status <> 'approved' then
    raise exception 'policy is not awaiting final approval';
  end if;

  if v_policy.final_approved_at is not null then
    return;
  end if;

  update public.policies
  set final_approved_at = now(),
      final_approved_by = v_actor,
      updated_at = now()
  where id = p_policy_id;

  insert into public.notifications (recipient_id, policy_id, version_id, type, title_ar, body_ar, action_url)
  values (
    v_policy.owner_id,
    p_policy_id,
    v_policy.approved_version_id,
    'policy_approved',
    'الاعتماد النهائي',
    'اعتمدت الإدارة التنفيذية السياسة بشكل نهائي.',
    '/app/policies/' || p_policy_id::text
  );

  perform public.log_audit(
    'policy_approved',
    'policies',
    p_policy_id,
    p_policy_id,
    jsonb_build_object('final_approval', true)
  );
end;
$$;

grant execute on function public.ceo_final_approve(uuid) to authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
