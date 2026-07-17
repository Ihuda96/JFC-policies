-- JFC Policies Platform - system admin recovery and username support hotfix
-- Safe to run in Supabase SQL Editor. No service-role key is required.
--
-- This file fixes the lockout case where a trusted admin accidentally changes
-- their own public.profiles.role away from system_admin. Supabase project-level
-- "super admin" rights are not automatically present in the browser JWT, so this
-- hotfix adds an email-based recovery override controlled from SQL Editor.

begin;

alter table public.profiles add column if not exists username text;

do $$ begin
  alter table public.profiles add constraint profiles_username_format check (username is null or username ~ '^[a-z0-9._-]{3,32}$');
exception when duplicate_object then null; end $$;

create unique index if not exists profiles_username_unique_idx on public.profiles (lower(username)) where username is not null;

create table if not exists public.system_admin_overrides (
  email text primary key,
  is_active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint system_admin_overrides_email_format check (email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$')
);

create index if not exists system_admin_overrides_active_idx on public.system_admin_overrides (is_active, email);

insert into public.system_admin_overrides (email, is_active, note)
values ('suoaljohani@moh.gov.sa', true, 'Initial JFC platform system administrator recovery account.')
on conflict (email) do update
set is_active = true,
    note = excluded.note,
    updated_at = now();

update public.profiles
set role = 'system_admin',
    status = 'active',
    updated_at = now()
where lower(email) = 'suoaljohani@moh.gov.sa';

insert into public.app_settings (key, value, description)
values
  ('username_login_enabled', 'true'::jsonb, 'Allow users to sign in with username through resolve_login_identifier.'),
  ('admin_user_creation_mode', '"supabase_auth_signup_detached_client"'::jsonb, 'Admins can create users with email, username, password, role, and status when Supabase Auth signups are enabled.')
on conflict (key) do update
set value = excluded.value,
    description = excluded.description,
    updated_at = now();

create or replace function public.normalize_username(p_username text)
returns text
language sql
immutable
as $$
  select nullif(lower(regexp_replace(trim(coalesce(p_username, '')), '\s+', '', 'g')), '')
$$;

create or replace function public.resolve_login_identifier(p_identifier text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when position('@' in trim(coalesce(p_identifier, ''))) > 0 then lower(trim(p_identifier))
    else (
      select p.email
      from public.profiles p
      where lower(p.username) = lower(trim(coalesce(p_identifier, '')))
        and p.status <> 'disabled'
      limit 1
    )
  end
$$;

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
      or exists (
        select 1
        from public.system_admin_overrides sao
        where sao.is_active
          and lower(sao.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
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

drop function if exists public.admin_update_profile(uuid, text, public.app_role, public.profile_status, text, text);
drop function if exists public.admin_update_profile(uuid, text, text, public.app_role, public.profile_status, text, text, text);
create or replace function public.admin_update_profile(
  p_user_id uuid,
  p_username text,
  p_full_name text,
  p_role public.app_role,
  p_status public.profile_status,
  p_department text default null,
  p_job_title text default null,
  p_phone text default null
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

drop trigger if exists system_admin_overrides_updated_at on public.system_admin_overrides;
create trigger system_admin_overrides_updated_at
before update on public.system_admin_overrides
for each row execute function public.set_updated_at();

alter table public.system_admin_overrides enable row level security;

drop policy if exists "system_admin_overrides_select_admin" on public.system_admin_overrides;
create policy "system_admin_overrides_select_admin"
on public.system_admin_overrides for select to authenticated
using (public.current_app_role() = 'system_admin');

drop policy if exists "system_admin_overrides_write_admin" on public.system_admin_overrides;
create policy "system_admin_overrides_write_admin"
on public.system_admin_overrides for all to authenticated
using (public.current_app_role() = 'system_admin')
with check (public.current_app_role() = 'system_admin');

grant execute on function public.is_platform_superadmin() to authenticated;
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.resolve_login_identifier(text) to anon, authenticated;
grant execute on function public.admin_update_profile(uuid, text, text, public.app_role, public.profile_status, text, text, text) to authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
