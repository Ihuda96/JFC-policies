-- JFC Policies Platform - superadmin recovery fix
-- Safe to run in Supabase SQL Editor. No service-role key is required.
-- Purpose:
--   If a Supabase Auth account has trusted app_metadata marking it as
--   superadmin, treat it as system_admin even if public.profiles.role was
--   accidentally changed.
--
-- Supported app_metadata forms:
--   {"superadmin": true}
--   {"is_super_admin": true}
--   {"system_admin": true}
--   {"role": "superadmin"}
--   {"app_role": "superadmin"}
--   {"roles": ["superadmin"]}
--   {"permissions": ["superadmin"]}

begin;

create or replace function public.is_platform_superadmin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with app_metadata as (
    select coalesce(auth.jwt() -> 'app_metadata', '{}'::jsonb) as claims
  )
  select auth.uid() is not null
    and (
      lower(coalesce(claims ->> 'role', '')) in ('superadmin', 'super_admin', 'system_admin')
      or lower(coalesce(claims ->> 'app_role', '')) in ('superadmin', 'super_admin', 'system_admin')
      or lower(coalesce(claims ->> 'superadmin', '')) in ('true', '1', 'yes')
      or lower(coalesce(claims ->> 'is_super_admin', '')) in ('true', '1', 'yes')
      or lower(coalesce(claims ->> 'system_admin', '')) in ('true', '1', 'yes')
      or exists (
        select 1
        from jsonb_array_elements_text(
          case when jsonb_typeof(claims -> 'roles') = 'array' then claims -> 'roles' else '[]'::jsonb end
        ) as role_claim(value)
        where lower(role_claim.value) in ('superadmin', 'super_admin', 'system_admin')
      )
      or exists (
        select 1
        from jsonb_array_elements_text(
          case when jsonb_typeof(claims -> 'permissions') = 'array' then claims -> 'permissions' else '[]'::jsonb end
        ) as permission_claim(value)
        where lower(permission_claim.value) in ('superadmin', 'super_admin', 'system_admin')
      )
    )
  from app_metadata
$$;

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_platform_superadmin() then 'system_admin'::public.app_role
    else (
      select role
      from public.profiles
      where id = auth.uid()
        and status = 'active'
      limit 1
    )
  end
$$;

create or replace function public.is_active_profile()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_platform_superadmin() or exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and status = 'active'
  )
$$;

create or replace function public.is_system_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select public.current_app_role() = 'system_admin' $$;

create or replace function public.admin_update_profile(
  p_user_id uuid,
  p_full_name text,
  p_role public.app_role,
  p_status public.profile_status,
  p_department text default null,
  p_job_title text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_role public.app_role;
begin
  if auth.uid() is null or not public.is_system_admin() then
    raise exception 'system admin role is required';
  end if;

  select role into v_old_role
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'profile not found';
  end if;

  update public.profiles
  set full_name = nullif(trim(coalesce(p_full_name, '')), ''),
      role = p_role,
      status = p_status,
      department = nullif(trim(coalesce(p_department, '')), ''),
      job_title = nullif(trim(coalesce(p_job_title, '')), ''),
      deactivated_at = case when p_status = 'disabled' then coalesce(deactivated_at, now()) else null end,
      updated_at = now()
  where id = p_user_id;

  perform public.log_audit(
    case when v_old_role is distinct from p_role then 'role_changed'::public.audit_event_type else 'profile_updated'::public.audit_event_type end,
    'profiles',
    p_user_id,
    null,
    jsonb_build_object('role', p_role, 'status', p_status)
  );
end;
$$;

grant execute on function public.is_platform_superadmin() to authenticated;
grant execute on function public.admin_update_profile(uuid, text, public.app_role, public.profile_status, text, text) to authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
