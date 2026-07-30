-- JFC Policies Platform — V2 upgrade, STEP 4
--
-- Run after DEPLOY_V2_STEP1_ROLES.sql and DEPLOY_V2_STEP2_FEATURES.sql.
-- Safe to run in the Supabase SQL Editor, safe to re-run.
--
-- The admin "add/edit user" form let an operator type any free-text
-- department name, so it never wrote profiles.department_code — the
-- structured code (e.g. HRD) that section-library access checks and the
-- rest of the app read. Self-registration and admin_approve_signup
-- already set it correctly; this brings admin_update_profile in line so a
-- department picked from the same list used for policies (lib/departments)
-- is saved with its code too.

begin;

drop function if exists public.admin_update_profile(uuid, text, text, public.app_role, public.profile_status, text, text, text);

create or replace function public.admin_update_profile(
  p_user_id uuid,
  p_username text,
  p_full_name text,
  p_role public.app_role,
  p_status public.profile_status,
  p_department text default null,
  p_job_title text default null,
  p_phone text default null,
  p_department_code text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_role public.app_role;
  v_username text;
begin
  if auth.uid() is null or not public.is_system_admin() then
    raise exception 'system admin role is required';
  end if;

  v_username := public.normalize_username(p_username);

  select role into v_old_role
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'profile not found';
  end if;

  update public.profiles
  set username = v_username,
      full_name = nullif(trim(coalesce(p_full_name, '')), ''),
      role = p_role,
      status = p_status,
      department = nullif(trim(coalesce(p_department, '')), ''),
      department_code = nullif(upper(trim(coalesce(p_department_code, ''))), ''),
      job_title = nullif(trim(coalesce(p_job_title, '')), ''),
      phone = nullif(trim(coalesce(p_phone, '')), ''),
      deactivated_at = case when p_status = 'disabled' then coalesce(deactivated_at, now()) else null end,
      updated_at = now()
  where id = p_user_id;

  perform public.log_audit(
    case when v_old_role is distinct from p_role then 'role_changed'::public.audit_event_type else 'profile_updated'::public.audit_event_type end,
    'profiles',
    p_user_id,
    null,
    jsonb_build_object('username', v_username, 'role', p_role, 'status', p_status)
  );
end;
$$;

grant execute on function public.admin_update_profile(uuid, text, text, public.app_role, public.profile_status, text, text, text, text) to authenticated;

commit;
