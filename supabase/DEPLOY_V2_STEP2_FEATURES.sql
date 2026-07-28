-- JFC Policies Platform — V2 upgrade, STEP 2 of 2
--
-- Run DEPLOY_V2_STEP1_ROLES.sql first, then run this file in the Supabase
-- SQL Editor. Safe to re-run. No service-role key required.
--
-- This step adds:
--   1. Department employees who can only add policies and read their own
--      department's approved policies. They register themselves and wait for
--      an administrator to approve the account and assign the department.
--   2. A CEO role that gives the final approval. Final approval promotes a
--      policy into the "final library".
--   3. Sections with their own barcode and a 5-digit access code, so a
--      section can browse only its own final-approved policies.
--
-- NOTE ON SIGN-UP EMAILS: department employees register with a username (no
-- email), so the app derives a login address of the form
-- <username>@jfc-policies.local. Supabase "Confirm email" must therefore be
-- turned OFF for this project (Authentication → Providers → Email).

begin;

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Columns and tables
-- ═══════════════════════════════════════════════════════════════════════

-- Structured department code (e.g. HRD) kept next to the display name so
-- access checks can match reliably.
alter table public.profiles add column if not exists department_code text;
alter table public.profiles add column if not exists must_change_password boolean not null default false;

-- Final (CEO) approval.
alter table public.policies add column if not exists final_approved_at timestamptz;
alter table public.policies add column if not exists final_approved_by uuid references public.profiles(id);

create index if not exists policies_final_approved_idx
  on public.policies (final_approved_at)
  where final_approved_at is not null;

-- Sections/departments that own a barcode and a 5-digit access code.
create table if not exists public.section_access (
  code text primary key,
  kind text not null default 'department',
  parent_code text,
  label text not null,
  access_code text not null default lpad((floor(random() * 100000))::int::text, 5, '0'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint section_access_kind_allowed check (kind in ('department', 'section')),
  constraint section_access_code_format check (access_code ~ '^[0-9]{5}$')
);

drop trigger if exists section_access_updated_at on public.section_access;
create trigger section_access_updated_at
before update on public.section_access
for each row execute function public.set_updated_at();

-- Passwords issued by an administrator (used for the CEO account). The
-- plaintext is kept only until the owner sets their own password, so an
-- administrator can hand over / re-issue credentials but a live password
-- chosen by the owner is never stored.
create table if not exists public.admin_issued_passwords (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  password_plain text,
  issued_at timestamptz not null default now(),
  issued_by uuid references public.profiles(id),
  consumed_at timestamptz
);

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Role predicates
-- ═══════════════════════════════════════════════════════════════════════

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

-- The quality team (manager AND quality employees) reviews submissions:
-- they can approve a policy or send it back with notes.
create or replace function public.can_review_policies()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_app_role() in ('quality_manager', 'quality_staff')
      or public.is_platform_superadmin()
$$;

create or replace function public.can_author_policies()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_app_role() in ('quality_staff', 'quality_manager', 'department_staff')
      or public.is_platform_superadmin()
$$;

create or replace function public.is_department_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select public.current_app_role() = 'department_staff' $$;

create or replace function public.is_ceo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select public.current_app_role() = 'ceo' or public.is_platform_superadmin() $$;

create or replace function public.current_department_code()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(upper(trim(coalesce(department_code, ''))), '')
  from public.profiles
  where id = auth.uid()
  limit 1
$$;

-- Department a policy belongs to, taken from the JFHC code when present.
create or replace function public.policy_department_code(
  p_policy_number text,
  p_owner_department text
)
returns text
language sql
immutable
as $$
  select case
    when coalesce(p_policy_number, '') ~* '^JFHC-[A-Za-z]{2,6}-'
      then upper(split_part(p_policy_number, '-', 2))
    else nullif(upper(trim(coalesce(p_owner_department, ''))), '')
  end
$$;

grant execute on function public.acts_as_quality_manager() to authenticated;
grant execute on function public.can_review_policies() to authenticated;
grant execute on function public.can_author_policies() to authenticated;
grant execute on function public.is_department_staff() to authenticated;
grant execute on function public.is_ceo() to authenticated;
grant execute on function public.current_department_code() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. Who can see which policy
-- ═══════════════════════════════════════════════════════════════════════

-- A department employee sees their own policies plus approved policies of
-- their own department. Everyone else keeps the previous behaviour.
create or replace function public.can_access_policy_record(p_policy_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.policies p
    where p.id = p_policy_id
      and public.is_active_profile()
      and (
        p.owner_id = auth.uid()
        or public.acts_as_quality_manager()
        or public.can_review_policies()
        or public.is_ceo()
        or (
          p.status = 'approved'
          and (
            not public.is_department_staff()
            or public.policy_department_code(p.policy_number, p.owner_department)
                 is not distinct from public.current_department_code()
          )
        )
      )
  )
$$;

create or replace function public.can_access_policy_content(p_policy_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.policies p
    where p.id = p_policy_id
      and public.is_active_profile()
      and (
        p.owner_id = auth.uid()
        or public.acts_as_quality_manager()
        or public.can_review_policies()
        or public.is_ceo()
        or (
          p.status = 'approved'
          and (
            not public.is_department_staff()
            or public.policy_department_code(p.policy_number, p.owner_department)
                 is not distinct from public.current_department_code()
          )
        )
      )
  )
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. Review workflow — quality team approves or returns
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.return_policy_for_revision(
  p_policy_id uuid,
  p_version_id uuid,
  p_comment text,
  p_page_number integer default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_owner uuid;
begin
  if v_actor is null or not public.can_review_policies() then
    raise exception 'quality team role is required';
  end if;

  if nullif(trim(coalesce(p_comment, '')), '') is null then
    raise exception 'return comment is required';
  end if;

  select owner_id into v_owner
  from public.policies
  where id = p_policy_id
    and status in ('pending_approval', 'resubmitted')
  for update;

  if not found then
    raise exception 'policy is not waiting for review';
  end if;

  if not exists (
    select 1 from public.policy_versions
    where id = p_version_id and policy_id = p_policy_id
  ) then
    raise exception 'version does not belong to policy';
  end if;

  insert into public.review_comments (policy_id, version_id, author_id, page_number, comment_text)
  values (p_policy_id, p_version_id, v_actor, p_page_number, trim(p_comment));

  update public.policy_versions
  set status = 'returned', returned_at = now(), updated_at = now()
  where id = p_version_id;

  update public.policies
  set status = 'returned_for_revision', updated_at = now()
  where id = p_policy_id;

  insert into public.approval_actions (policy_id, version_id, actor_id, action, comment)
  values (p_policy_id, p_version_id, v_actor, 'returned', trim(p_comment));

  insert into public.notifications (recipient_id, policy_id, version_id, type, title_ar, body_ar, action_url)
  values (
    v_owner,
    p_policy_id,
    p_version_id,
    'policy_returned',
    'إعادة سياسة للتعديل',
    'أُعيدت السياسة للتعديل مع ملاحظات.',
    '/app/policies/' || p_policy_id::text
  );

  perform public.log_audit(
    'policy_returned', 'policies', p_policy_id, p_policy_id,
    jsonb_build_object('version_id', p_version_id)
  );
end;
$$;

create or replace function public.approve_policy_version(
  p_policy_id uuid,
  p_version_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_owner uuid;
  v_review_months integer := 36;
  v_review_date date;
begin
  if v_actor is null or not public.can_review_policies() then
    raise exception 'quality team role is required';
  end if;

  select owner_id into v_owner
  from public.policies
  where id = p_policy_id
    and status in ('pending_approval', 'resubmitted')
  for update;

  if not found then
    raise exception 'policy is not waiting for approval';
  end if;

  if not exists (
    select 1 from public.policy_versions
    where id = p_version_id and policy_id = p_policy_id
  ) then
    raise exception 'version does not belong to policy';
  end if;

  select coalesce((value #>> '{}')::integer, 36)
  into v_review_months
  from public.app_settings
  where key = 'default_review_interval_months';

  select coalesce(review_date, (current_date + make_interval(months => v_review_months))::date)
  into v_review_date
  from public.policy_metadata
  where policy_id = p_policy_id;

  if v_review_date is null then
    v_review_date := (current_date + make_interval(months => v_review_months))::date;
  end if;

  update public.policy_versions
  set status = 'superseded', updated_at = now()
  where policy_id = p_policy_id and id <> p_version_id and status = 'approved';

  update public.policy_versions
  set status = 'approved', approved_by = v_actor, approved_at = now(), updated_at = now()
  where id = p_version_id;

  update public.policies
  set status = 'approved',
      current_version_id = p_version_id,
      approved_version_id = p_version_id,
      approved_at = now(),
      next_review_at = v_review_date,
      updated_at = now()
  where id = p_policy_id;

  insert into public.approval_actions (policy_id, version_id, actor_id, action, comment)
  values (p_policy_id, p_version_id, v_actor, 'approved', 'اعتماد ونشر');

  insert into public.notifications (recipient_id, policy_id, version_id, type, title_ar, body_ar, action_url)
  values (
    v_owner, p_policy_id, p_version_id, 'policy_approved',
    'اعتماد السياسة', 'تم اعتماد السياسة ونشرها في المكتبة.',
    '/app/policies/' || p_policy_id::text
  );

  -- Tell the CEO there is something waiting for the final approval.
  insert into public.notifications (recipient_id, policy_id, version_id, type, title_ar, body_ar, action_url)
  select p.id, p_policy_id, p_version_id, 'policy_approved',
         'بانتظار الاعتماد النهائي',
         'سياسة معتمدة من الجودة وبانتظار اعتمادك النهائي.',
         '/executive'
  from public.profiles p
  where p.role = 'ceo' and p.status = 'active';

  perform public.log_audit(
    'policy_approved', 'policies', p_policy_id, p_policy_id,
    jsonb_build_object('version_id', p_version_id)
  );
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. CEO final approval
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.ceo_final_approve(p_policy_id uuid)
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

  if v_policy.status <> 'approved' then
    raise exception 'policy must be approved by quality before the final approval';
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
    v_policy.owner_id, p_policy_id, v_policy.approved_version_id, 'policy_approved',
    'الاعتماد النهائي', 'اعتمدت الإدارة التنفيذية السياسة بشكل نهائي.',
    '/app/policies/' || p_policy_id::text
  );

  perform public.log_audit(
    'policy_approved', 'policies', p_policy_id, p_policy_id,
    jsonb_build_object('final_approval', true)
  );
end;
$$;

create or replace function public.ceo_return_policy(p_policy_id uuid, p_comment text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_policy public.policies%rowtype;
  v_version uuid;
begin
  if v_actor is null or not public.is_ceo() then
    raise exception 'executive role is required';
  end if;

  if nullif(trim(coalesce(p_comment, '')), '') is null then
    raise exception 'a note is required';
  end if;

  select * into v_policy
  from public.policies
  where id = p_policy_id
  for update;

  if not found then
    raise exception 'policy not found';
  end if;

  v_version := coalesce(v_policy.approved_version_id, v_policy.current_version_id);
  if v_version is null then
    raise exception 'policy version is required';
  end if;

  insert into public.review_comments (policy_id, version_id, author_id, comment_text)
  values (p_policy_id, v_version, v_actor, trim(p_comment));

  update public.policy_versions
  set status = 'returned', returned_at = now(), updated_at = now()
  where id = v_version;

  update public.policies
  set status = 'returned_for_revision',
      final_approved_at = null,
      final_approved_by = null,
      updated_at = now()
  where id = p_policy_id;

  insert into public.approval_actions (policy_id, version_id, actor_id, action, comment)
  values (p_policy_id, v_version, v_actor, 'returned', trim(p_comment));

  insert into public.notifications (recipient_id, policy_id, version_id, type, title_ar, body_ar, action_url)
  values (
    v_policy.owner_id, p_policy_id, v_version, 'policy_returned',
    'ملاحظات من الإدارة التنفيذية', 'أُعيدت السياسة مع ملاحظات تنفيذية.',
    '/app/policies/' || p_policy_id::text
  );

  perform public.log_audit(
    'policy_returned', 'policies', p_policy_id, p_policy_id,
    jsonb_build_object('executive_return', true)
  );
end;
$$;

grant execute on function public.ceo_final_approve(uuid) to authenticated;
grant execute on function public.ceo_return_policy(uuid, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 6. Registration requests and administrator tools
-- ═══════════════════════════════════════════════════════════════════════

-- New sign-ups may ask to be a department employee; everything else still
-- defaults to a pending quality employee.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requested text := lower(trim(coalesce(new.raw_user_meta_data->>'requested_role', '')));
begin
  insert into public.profiles (
    id, email, username, full_name, role, status,
    department, department_code, job_title, phone
  )
  values (
    new.id,
    new.email,
    public.normalize_username(new.raw_user_meta_data->>'username'),
    nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', '')), ''),
    case when v_requested = 'department_staff' then 'department_staff'::public.app_role
         else 'quality_staff'::public.app_role end,
    'pending',
    nullif(trim(coalesce(new.raw_user_meta_data->>'department', '')), ''),
    nullif(upper(trim(coalesce(new.raw_user_meta_data->>'department_code', ''))), ''),
    nullif(trim(coalesce(new.raw_user_meta_data->>'job_title', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data->>'phone', '')), '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- Approve a registration request, optionally overriding the department.
create or replace function public.admin_approve_signup(
  p_user_id uuid,
  p_department_code text default null,
  p_department_label text default null,
  p_role public.app_role default 'department_staff'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_system_admin() then
    raise exception 'system admin role is required';
  end if;

  update public.profiles
  set role = p_role,
      status = 'active',
      department_code = coalesce(nullif(upper(trim(coalesce(p_department_code, ''))), ''), department_code),
      department = coalesce(nullif(trim(coalesce(p_department_label, '')), ''), department),
      deactivated_at = null,
      updated_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'profile not found';
  end if;

  insert into public.notifications (recipient_id, type, title_ar, body_ar, action_url)
  values (p_user_id, 'account_activated', 'تم تفعيل حسابك',
          'يمكنك الآن الدخول وإضافة سياسات إدارتك.', '/app');

  perform public.log_audit(
    'role_changed', 'profiles', p_user_id, null,
    jsonb_build_object('approved_signup', true, 'role', p_role)
  );
end;
$$;

create or replace function public.admin_reject_signup(p_user_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_system_admin() then
    raise exception 'system admin role is required';
  end if;

  update public.profiles
  set status = 'disabled', deactivated_at = now(), updated_at = now()
  where id = p_user_id;

  perform public.log_audit(
    'profile_updated', 'profiles', p_user_id, null,
    jsonb_build_object('rejected_signup', true, 'reason', p_reason)
  );
end;
$$;

-- Set (or reset) the password of a managed account, e.g. the CEO. The
-- plaintext is stored only until the owner replaces it with their own.
create or replace function public.admin_set_user_password(p_user_id uuid, p_password text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if auth.uid() is null or not public.is_system_admin() then
    raise exception 'system admin role is required';
  end if;

  if length(coalesce(p_password, '')) < 8 then
    raise exception 'password must be at least 8 characters';
  end if;

  update auth.users
  set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
      updated_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'account not found';
  end if;

  update public.profiles
  set must_change_password = true, updated_at = now()
  where id = p_user_id;

  insert into public.admin_issued_passwords (user_id, password_plain, issued_at, issued_by, consumed_at)
  values (p_user_id, p_password, now(), auth.uid(), null)
  on conflict (user_id) do update
  set password_plain = excluded.password_plain,
      issued_at = now(),
      issued_by = excluded.issued_by,
      consumed_at = null;

  perform public.log_audit(
    'profile_updated', 'profiles', p_user_id, null,
    jsonb_build_object('password_reset_by_admin', true)
  );
end;
$$;

-- Called by the owner right after they choose their own password.
create or replace function public.complete_password_change()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  update public.profiles
  set must_change_password = false, updated_at = now()
  where id = auth.uid();

  update public.admin_issued_passwords
  set password_plain = null, consumed_at = now()
  where user_id = auth.uid();
end;
$$;

grant execute on function public.admin_approve_signup(uuid, text, text, public.app_role) to authenticated;
grant execute on function public.admin_reject_signup(uuid, text) to authenticated;
grant execute on function public.admin_set_user_password(uuid, text) to authenticated;
grant execute on function public.complete_password_change() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 7. Sections, barcodes and the 5-digit gate
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.admin_upsert_section(
  p_code text,
  p_kind text,
  p_parent_code text,
  p_label text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_system_admin() then
    raise exception 'system admin role is required';
  end if;

  insert into public.section_access (code, kind, parent_code, label)
  values (upper(trim(p_code)), coalesce(nullif(trim(p_kind), ''), 'department'),
          nullif(upper(trim(coalesce(p_parent_code, ''))), ''), trim(p_label))
  on conflict (code) do update
  set kind = excluded.kind,
      parent_code = excluded.parent_code,
      label = excluded.label,
      updated_at = now();
end;
$$;

create or replace function public.admin_set_section_code(p_code text, p_access_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_system_admin() then
    raise exception 'system admin role is required';
  end if;

  if coalesce(p_access_code, '') !~ '^[0-9]{5}$' then
    raise exception 'access code must be exactly 5 digits';
  end if;

  update public.section_access
  set access_code = p_access_code, updated_at = now()
  where code = upper(trim(p_code));

  if not found then
    raise exception 'section not found';
  end if;
end;
$$;

-- Public: the barcode landing page shows only the section name.
create or replace function public.section_public_label(p_code text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select label
  from public.section_access
  where code = upper(trim(coalesce(p_code, ''))) and is_active
  limit 1
$$;

-- Public: exchange the 5-digit code for that section's final-approved
-- policies. Returns no rows when the code is wrong.
create or replace function public.open_section_library(p_code text, p_access_code text)
returns table (
  id uuid,
  title text,
  policy_number text,
  approved_at timestamptz,
  final_approved_at timestamptz,
  next_review_at date,
  department_code text
)
language sql
stable
security definer
set search_path = public
as $$
  with target as (
    select code, parent_code
    from public.section_access
    where code = upper(trim(coalesce(p_code, '')))
      and is_active
      and access_code = trim(coalesce(p_access_code, ''))
  )
  select p.id,
         p.title,
         p.policy_number,
         p.approved_at,
         p.final_approved_at,
         p.next_review_at,
         public.policy_department_code(p.policy_number, p.owner_department) as department_code
  from public.policies p, target t
  where p.final_approved_at is not null
    and p.status = 'approved'
    and (
      public.policy_department_code(p.policy_number, p.owner_department) = t.code
      or upper(split_part(coalesce(p.policy_number, ''), '-', 3)) = t.code
    )
  order by p.final_approved_at desc
$$;

grant execute on function public.admin_upsert_section(text, text, text, text) to authenticated;
grant execute on function public.admin_set_section_code(text, text) to authenticated;
grant execute on function public.section_public_label(text) to anon, authenticated;
grant execute on function public.open_section_library(text, text) to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 8. Row level security
-- ═══════════════════════════════════════════════════════════════════════

alter table public.section_access enable row level security;
alter table public.admin_issued_passwords enable row level security;

drop policy if exists "section_access_admin_all" on public.section_access;
create policy "section_access_admin_all"
on public.section_access for all to authenticated
using (public.is_system_admin())
with check (public.is_system_admin());

drop policy if exists "admin_issued_passwords_admin_all" on public.admin_issued_passwords;
create policy "admin_issued_passwords_admin_all"
on public.admin_issued_passwords for all to authenticated
using (public.is_system_admin())
with check (public.is_system_admin());

-- Administrators must be able to read every profile to approve requests.
drop policy if exists "profiles_select_allowed" on public.profiles;
create policy "profiles_select_allowed"
on public.profiles for select to authenticated
using (
  id = auth.uid()
  or public.current_app_role() in ('quality_manager', 'system_admin')
  or public.is_platform_superadmin()
);

-- Department employees may create their own policies.
drop policy if exists "policies_insert_staff_manager" on public.policies;
create policy "policies_insert_staff_manager"
on public.policies for insert to authenticated
with check (
  public.can_author_policies()
  and owner_id = auth.uid()
  and created_by = auth.uid()
);

drop policy if exists "policy_versions_insert_owner_manager" on public.policy_versions;
create policy "policy_versions_insert_owner_manager"
on public.policy_versions for insert to authenticated
with check (
  exists (
    select 1 from public.policies p
    where p.id = policy_id
      and (p.owner_id = auth.uid() or public.can_review_policies())
  )
);

drop policy if exists "policy_files_insert_owner_manager" on public.policy_files;
create policy "policy_files_insert_owner_manager"
on public.policy_files for insert to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1 from public.policies p
    where p.id = policy_id
      and (p.owner_id = auth.uid() or public.can_review_policies())
  )
);

drop policy if exists "review_comments_manager_insert" on public.review_comments;
create policy "review_comments_manager_insert"
on public.review_comments for insert to authenticated
with check ((public.can_review_policies() or public.is_ceo()) and author_id = auth.uid());

drop policy if exists "policy_metadata_manager_admin_write" on public.policy_metadata;
create policy "policy_metadata_manager_admin_write"
on public.policy_metadata for all to authenticated
using (public.can_review_policies() or public.current_app_role() = 'system_admin')
with check (public.can_review_policies() or public.current_app_role() = 'system_admin');

select pg_notify('pgrst', 'reload schema');

commit;
