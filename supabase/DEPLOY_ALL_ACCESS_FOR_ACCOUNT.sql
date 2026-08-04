-- JFC Policies Platform — grant ONE account combined access
-- (quality employee + quality manager + system admin) at the same time.
--
-- Safe to run in the Supabase SQL Editor. No service-role key required.
-- Idempotent: re-running it is harmless. Assumes DEPLOY_V2_STEP1_ROLES.sql
-- and DEPLOY_V2_STEP2_FEATURES.sql have already been applied.
--
-- HOW IT WORKS
-- A "platform super admin" (email allowlist / super-admin JWT claim, see
-- public.system_admin_overrides) already maps to system_admin via
-- public.is_platform_superadmin(), which covers the admin side. V2's own
-- can_review_policies()/can_author_policies()/acts_as_quality_manager()
-- helpers already fold is_platform_superadmin() into their checks, so the
-- designated account automatically gets reviewer and author rights too —
-- this script no longer needs to (and must not) redefine
-- can_access_policy_content / return_policy_for_revision /
-- approve_policy_version or the insert RLS policies to achieve that; V2's
-- versions already cover it, and are broader (they also seat quality_staff,
-- the CEO, and department_staff correctly). Redefining them here again with
-- the older, narrower acts_as_quality_manager()-only logic would silently
-- undo that broadening if this file happened to run after V2 — which is
-- exactly the bug this revision removes. Only emails in
-- public.system_admin_overrides are affected by anything below; every
-- other user keeps their normal single role.
--
-- The target account must already exist in Supabase Auth (the person has
-- signed up / been created) and sign in with the email below.

begin;

-- ── 1. Capability predicate ─────────────────────────────────────────────
-- "Acts as a quality manager" = actually a quality manager, OR a designated
-- platform super admin (email allowlist / super-admin JWT claim). Identical
-- to the definition in DEPLOY_V2_STEP2_FEATURES.sql — kept here only so
-- this file still works if it's ever run before V2 has been applied; the
-- two definitions always converge to the same behavior regardless of order.
create or replace function public.acts_as_quality_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_app_role() = 'quality_manager'
      or public.is_platform_superadmin()
$$;

grant execute on function public.acts_as_quality_manager() to authenticated;

-- ── 2. Manager-only actions V2 doesn't already broaden ──────────────────
-- submit_policy_version and archive_policy are untouched by
-- DEPLOY_V2_STEP2_FEATURES.sql, so — unlike the functions removed above —
-- redefining them here is still the only way a plain system_admin-role
-- super admin (as opposed to the owner) gets to submit or archive someone
-- else's policy. Kept exactly as before.
--
-- Submit a policy version (managers may submit policies they do not own).
create or replace function public.submit_policy_version(
  p_policy_id uuid,
  p_version_id uuid,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_policy public.policies%rowtype;
  v_action public.approval_action_type;
  v_next_status public.policy_status;
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

  if v_policy.owner_id <> v_actor and not public.acts_as_quality_manager() then
    raise exception 'not allowed to submit this policy';
  end if;

  if not exists (
    select 1
    from public.policy_versions
    where id = p_version_id
      and policy_id = p_policy_id
      and status in ('draft', 'returned')
  ) then
    raise exception 'version is not submittable';
  end if;

  if v_policy.status = 'returned_for_revision' then
    v_action := 'resubmitted';
    v_next_status := 'resubmitted';
  else
    v_action := 'submitted';
    v_next_status := 'pending_approval';
  end if;

  update public.policy_versions
  set status = 'submitted',
      submitted_by = v_actor,
      submitted_at = now(),
      manager_note = nullif(trim(coalesce(p_note, manager_note, '')), ''),
      updated_at = now()
  where id = p_version_id;

  update public.policies
  set status = v_next_status,
      current_version_id = p_version_id,
      submitted_at = now(),
      updated_at = now()
  where id = p_policy_id;

  insert into public.approval_actions (policy_id, version_id, actor_id, action, comment)
  values (p_policy_id, p_version_id, v_actor, v_action, nullif(trim(coalesce(p_note, '')), ''));

  insert into public.notifications (recipient_id, policy_id, version_id, type, title_ar, body_ar, action_url)
  select p.id,
         p_policy_id,
         p_version_id,
         'policy_submitted',
         'طلب اعتماد جديد',
         'تم إرسال سياسة بانتظار قرار مدير الجودة.',
         '/app/policies/' || p_policy_id::text
  from public.profiles p
  where p.role = 'quality_manager'
    and p.status = 'active';

  perform public.log_audit(
    case when v_action = 'resubmitted' then 'policy_resubmitted'::public.audit_event_type else 'policy_submitted'::public.audit_event_type end,
    'policies',
    p_policy_id,
    p_policy_id,
    jsonb_build_object('version_id', p_version_id)
  );
end;
$$;

-- Archive/delete a policy (managers may archive any policy).
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
    public.acts_as_quality_manager()
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

-- ── 3. Designate the account (email allowlist) ──────────────────────────
-- (Section that used to redefine the policies/policy_versions/policy_files/
-- review_comments insert RLS policies has been removed — V2 already defines
-- them with the correct, broader can_author_policies()/can_review_policies()
-- checks, which already cover a platform super admin. Redefining them here
-- with the older acts_as_quality_manager()-only logic would silently narrow
-- them back down if this file ran after V2.)
insert into public.system_admin_overrides (email, is_active, note)
values ('hudajuhany@gmail.com', true, 'Combined access: quality employee + manager + system admin.')
on conflict (email) do update
set is_active = true,
    note = excluded.note,
    updated_at = now();

-- Keep her stored profile sensible if it already exists (she must have
-- signed up first). The override grants access regardless of this row.
update public.profiles
set role = 'system_admin',
    status = 'active',
    updated_at = now()
where lower(email) = 'hudajuhany@gmail.com';

-- The app calls these from the browser to detect the super account.
grant execute on function public.is_platform_superadmin() to authenticated;
grant execute on function public.current_app_role() to authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
