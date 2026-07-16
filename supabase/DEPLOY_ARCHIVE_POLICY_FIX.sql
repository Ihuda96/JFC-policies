-- Hotfix for production projects that were deployed before archive_policy existed.
-- Safe to run in Supabase SQL Editor. No service-role key is required.

begin;

create or replace function public.archive_policy(
  p_policy_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_policy public.policies%rowtype;
  v_version_id uuid;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if v_actor is null or not public.is_active_profile() then
    raise exception 'active authenticated profile is required';
  end if;

  select * into v_policy
  from public.policies
  where id = p_policy_id
  for update;

  if not found then
    raise exception 'policy not found';
  end if;

  if v_policy.status = 'archived' then
    raise exception 'policy is already archived';
  end if;

  if not (
    public.current_app_role() = 'quality_manager'
    or (
      v_policy.owner_id = v_actor
      and v_policy.status in ('draft', 'returned_for_revision')
    )
  ) then
    raise exception 'not allowed to archive this policy';
  end if;

  v_version_id := coalesce(v_policy.current_version_id, v_policy.approved_version_id);

  if v_version_id is null or not exists (
    select 1
    from public.policy_versions
    where id = v_version_id
      and policy_id = p_policy_id
  ) then
    select id into v_version_id
    from public.policy_versions
    where policy_id = p_policy_id
    order by version_number desc
    limit 1;
  end if;

  if v_version_id is null then
    raise exception 'policy version is required to archive policy';
  end if;

  update public.policy_versions
  set status = 'archived',
      updated_at = now()
  where policy_id = p_policy_id
    and status <> 'archived';

  update public.policies
  set status = 'archived',
      archived_at = now(),
      updated_at = now()
  where id = p_policy_id;

  insert into public.approval_actions (policy_id, version_id, actor_id, action, comment)
  values (p_policy_id, v_version_id, v_actor, 'archived', v_reason);

  perform public.log_audit(
    'policy_archived',
    'policies',
    p_policy_id,
    p_policy_id,
    jsonb_build_object(
      'version_id', v_version_id,
      'previous_status', v_policy.status,
      'reason', v_reason
    )
  );
end;
$$;

grant execute on function public.archive_policy(uuid, text) to authenticated;
notify pgrst, 'reload schema';

commit;
