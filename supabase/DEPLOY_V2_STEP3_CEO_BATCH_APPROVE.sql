-- JFC Policies Platform — V2 upgrade, STEP 3 of 3
--
-- Run after DEPLOY_V2_STEP1_ROLES.sql and DEPLOY_V2_STEP2_FEATURES.sql.
-- Safe to run in the Supabase SQL Editor, safe to re-run.
--
-- Adds a single "approve everything waiting" action for the executive
-- office, so the CEO finalises the whole queue in one click instead of
-- approving policies one at a time. Returning a policy for revision (the
-- exception path) already exists via public.ceo_return_policy and is
-- untouched — returning it takes it out of the batch automatically,
-- since its status stops being 'approved'.

begin;

create or replace function public.ceo_final_approve_all()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_count integer := 0;
begin
  if v_actor is null or not public.is_ceo() then
    raise exception 'executive role is required';
  end if;

  create temporary table _final_approved_batch on commit drop as
  with updated as (
    update public.policies
    set final_approved_at = now(),
        final_approved_by = v_actor,
        updated_at = now()
    where status = 'approved'
      and final_approved_at is null
    returning id, owner_id, approved_version_id
  )
  select * from updated;

  select count(*) into v_count from _final_approved_batch;

  insert into public.notifications (recipient_id, policy_id, version_id, type, title_ar, body_ar, action_url)
  select owner_id, id, approved_version_id, 'policy_approved',
         'الاعتماد النهائي', 'اعتمدت الإدارة التنفيذية السياسة بشكل نهائي.',
         '/app/policies/' || id::text
  from _final_approved_batch;

  if v_count > 0 then
    perform public.log_audit(
      'policy_approved',
      'policies',
      null,
      null,
      jsonb_build_object('bulk_final_approval', true, 'count', v_count)
    );
  end if;

  return v_count;
end;
$$;

grant execute on function public.ceo_final_approve_all() to authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
