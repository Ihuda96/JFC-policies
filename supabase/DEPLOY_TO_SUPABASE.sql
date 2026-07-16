-- JFC Policies Platform production schema
-- Safe to run in the Supabase SQL Editor. No service-role key is required.

begin;

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.app_role as enum ('quality_staff', 'quality_manager', 'system_admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.profile_status as enum ('pending', 'active', 'disabled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.policy_status as enum (
    'draft',
    'pending_approval',
    'returned_for_revision',
    'resubmitted',
    'approved',
    'archived'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.policy_version_status as enum (
    'draft',
    'submitted',
    'returned',
    'approved',
    'superseded',
    'archived'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.document_type as enum (
    'policy',
    'procedure',
    'protocol',
    'guide',
    'form',
    'work_instruction'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.policy_file_kind as enum ('original', 'preview', 'approved_pdf');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.approval_action_type as enum (
    'submitted',
    'returned',
    'resubmitted',
    'approved',
    'archived'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.processing_status as enum (
    'queued',
    'processing',
    'completed',
    'failed',
    'needs_classification_review'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.notification_type as enum (
    'policy_submitted',
    'policy_returned',
    'policy_approved',
    'comment_added',
    'review_due',
    'processing_failed',
    'role_changed'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.audit_event_type as enum (
    'profile_created',
    'profile_updated',
    'role_changed',
    'policy_created',
    'file_uploaded',
    'policy_submitted',
    'policy_returned',
    'policy_resubmitted',
    'policy_approved',
    'policy_archived',
    'file_previewed',
    'file_downloaded',
    'file_printed',
    'category_updated',
    'notification_read',
    'processing_failed'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.category_kind as enum (
    'sector',
    'general_department',
    'department',
    'document_type',
    'topic'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  full_name text,
  role public.app_role not null default 'quality_staff',
  status public.profile_status not null default 'pending',
  department text,
  job_title text,
  phone text,
  invited_by uuid references public.profiles(id),
  last_seen_at timestamptz,
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_email_format check (email is null or email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$')
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  kind public.category_kind not null,
  parent_id uuid references public.categories(id) on delete restrict,
  name_ar text not null,
  name_en text,
  code text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_name_not_blank check (length(trim(name_ar)) > 0),
  constraint categories_unique_name unique nulls not distinct (kind, parent_id, name_ar)
);

create table if not exists public.policies (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  policy_number text,
  status public.policy_status not null default 'draft',
  owner_id uuid not null references public.profiles(id),
  created_by uuid not null references public.profiles(id),
  assigned_manager_id uuid references public.profiles(id),
  current_version_id uuid,
  approved_version_id uuid,
  sector_category_id uuid references public.categories(id),
  general_department_category_id uuid references public.categories(id),
  department_category_id uuid references public.categories(id),
  topic_category_id uuid references public.categories(id),
  document_type public.document_type not null default 'policy',
  owner_department text,
  submitted_at timestamptz,
  approved_at timestamptz,
  next_review_at date,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint policies_title_not_blank check (length(trim(title)) > 0),
  constraint policies_approval_fields check (
    (status <> 'approved') or (approved_version_id is not null and approved_at is not null)
  )
);

create table if not exists public.policy_versions (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.policies(id) on delete cascade,
  version_number integer not null,
  status public.policy_version_status not null default 'draft',
  source_file_name text not null,
  submitted_by uuid references public.profiles(id),
  submitted_at timestamptz,
  returned_at timestamptz,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  manager_note text,
  change_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint policy_versions_positive_version check (version_number > 0),
  constraint policy_versions_unique_number unique (policy_id, version_number)
);

do $$ begin
  alter table public.policies
    add constraint policies_current_version_fk
    foreign key (current_version_id) references public.policy_versions(id);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.policies
    add constraint policies_approved_version_fk
    foreign key (approved_version_id) references public.policy_versions(id);
exception when duplicate_object then null; end $$;

create table if not exists public.policy_files (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.policies(id) on delete cascade,
  version_id uuid not null references public.policy_versions(id) on delete cascade,
  bucket_id text not null,
  storage_path text not null,
  file_kind public.policy_file_kind not null,
  file_name text not null,
  content_type text not null,
  file_size bigint not null,
  checksum text,
  page_count integer,
  preview_ready boolean not null default false,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint policy_files_size_positive check (file_size > 0),
  constraint policy_files_bucket_allowed check (bucket_id in ('policy-originals', 'policy-previews', 'policy-approved')),
  constraint policy_files_content_type_allowed check (
    content_type in (
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
  ),
  constraint policy_files_unique_object unique (bucket_id, storage_path),
  constraint policy_files_unique_kind_per_version unique (version_id, file_kind, bucket_id, storage_path)
);

create table if not exists public.policy_metadata (
  policy_id uuid primary key references public.policies(id) on delete cascade,
  extracted_title text,
  extracted_policy_number text,
  extracted_version text,
  issuing_department text,
  issue_date date,
  review_date date,
  approval_date date,
  language text not null default 'ar',
  confidence numeric(5, 4),
  extraction_status public.processing_status not null default 'queued',
  needs_review boolean not null default false,
  search_text text,
  search_vector tsvector generated always as (
    to_tsvector(
      'simple',
      coalesce(extracted_title, '') || ' ' ||
      coalesce(extracted_policy_number, '') || ' ' ||
      coalesce(issuing_department, '') || ' ' ||
      coalesce(search_text, '')
    )
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint policy_metadata_confidence_range check (confidence is null or (confidence >= 0 and confidence <= 1))
);

create table if not exists public.review_comments (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.policies(id) on delete cascade,
  version_id uuid not null references public.policy_versions(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  page_number integer,
  comment_text text not null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint review_comments_text_not_blank check (length(trim(comment_text)) > 0),
  constraint review_comments_page_positive check (page_number is null or page_number > 0)
);

create table if not exists public.approval_actions (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.policies(id) on delete cascade,
  version_id uuid not null references public.policy_versions(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  action public.approval_action_type not null,
  comment text,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  policy_id uuid references public.policies(id) on delete cascade,
  version_id uuid references public.policy_versions(id) on delete cascade,
  type public.notification_type not null,
  title_ar text not null,
  body_ar text not null,
  action_url text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id bigserial primary key,
  event_time timestamptz not null default now(),
  actor_id uuid references public.profiles(id),
  event_type public.audit_event_type not null,
  entity_table text,
  entity_id uuid,
  policy_id uuid references public.policies(id),
  ip_address inet,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index if not exists profiles_role_status_idx on public.profiles (role, status);
create index if not exists categories_parent_idx on public.categories (parent_id, kind, is_active);
create index if not exists policies_owner_status_idx on public.policies (owner_id, status, updated_at desc);
create index if not exists policies_status_approved_idx on public.policies (status, approved_at desc);
create index if not exists policies_number_trgm_idx on public.policies using gin (policy_number extensions.gin_trgm_ops);
create index if not exists policies_title_trgm_idx on public.policies using gin (title extensions.gin_trgm_ops);
create index if not exists policy_versions_policy_idx on public.policy_versions (policy_id, version_number desc);
create index if not exists policy_files_policy_version_idx on public.policy_files (policy_id, version_id, file_kind);
create index if not exists policy_metadata_search_idx on public.policy_metadata using gin (search_vector);
create index if not exists review_comments_policy_version_idx on public.review_comments (policy_id, version_id, created_at desc);
create index if not exists approval_actions_policy_idx on public.approval_actions (policy_id, created_at desc);
create index if not exists notifications_recipient_unread_idx on public.notifications (recipient_id, read_at, created_at desc);
create index if not exists audit_logs_time_idx on public.audit_logs (event_time desc);
create index if not exists audit_logs_policy_idx on public.audit_logs (policy_id, event_time desc);
create index if not exists audit_logs_actor_idx on public.audit_logs (actor_id, event_time desc);

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = auth.uid()
    and status = 'active'
  limit 1
$$;

create or replace function public.is_active_profile()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and status = 'active'
  )
$$;

create or replace function public.is_quality_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select public.current_app_role() = 'quality_manager' $$;

create or replace function public.is_system_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select public.current_app_role() = 'system_admin' $$;

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
        or public.current_app_role() in ('quality_manager', 'system_admin')
        or p.status = 'approved'
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
        or public.current_app_role() = 'quality_manager'
        or p.status = 'approved'
      )
  )
$$;

create or replace function public.log_audit(
  p_event_type public.audit_event_type,
  p_entity_table text default null,
  p_entity_id uuid default null,
  p_policy_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  insert into public.audit_logs (
    actor_id,
    event_type,
    entity_table,
    entity_id,
    policy_id,
    metadata
  )
  values (
    auth.uid(),
    p_event_type,
    p_entity_table,
    p_entity_id,
    p_policy_id,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role, status)
  values (
    new.id,
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', '')), ''),
    'quality_staff',
    'pending'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create or replace function public.prevent_audit_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_logs rows cannot be updated or deleted';
end;
$$;

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

  if v_policy.owner_id <> v_actor and public.current_app_role() <> 'quality_manager' then
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
  if v_actor is null or public.current_app_role() <> 'quality_manager' then
    raise exception 'quality manager role is required';
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

  insert into public.review_comments (
    policy_id,
    version_id,
    author_id,
    page_number,
    comment_text
  )
  values (
    p_policy_id,
    p_version_id,
    v_actor,
    p_page_number,
    trim(p_comment)
  );

  update public.policy_versions
  set status = 'returned',
      returned_at = now(),
      updated_at = now()
  where id = p_version_id;

  update public.policies
  set status = 'returned_for_revision',
      updated_at = now()
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
    'أعاد مدير الجودة السياسة للتعديل مع ملاحظات إلزامية.',
    '/app/policies/' || p_policy_id::text
  );

  perform public.log_audit(
    'policy_returned',
    'policies',
    p_policy_id,
    p_policy_id,
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
  if v_actor is null or public.current_app_role() <> 'quality_manager' then
    raise exception 'quality manager role is required';
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
  set status = 'superseded',
      updated_at = now()
  where policy_id = p_policy_id
    and id <> p_version_id
    and status = 'approved';

  update public.policy_versions
  set status = 'approved',
      approved_by = v_actor,
      approved_at = now(),
      updated_at = now()
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
    v_owner,
    p_policy_id,
    p_version_id,
    'policy_approved',
    'اعتماد السياسة',
    'تم اعتماد السياسة ونشرها في المكتبة.',
    '/app/policies/' || p_policy_id::text
  );

  perform public.log_audit(
    'policy_approved',
    'policies',
    p_policy_id,
    p_policy_id,
    jsonb_build_object('version_id', p_version_id)
  );
end;
$$;

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

create or replace function public.track_file_access(
  p_file_id uuid,
  p_action text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_file public.policy_files%rowtype;
  v_event public.audit_event_type;
begin
  select * into v_file
  from public.policy_files
  where id = p_file_id;

  if not found then
    raise exception 'file not found';
  end if;

  if not public.can_access_policy_content(v_file.policy_id) then
    raise exception 'not allowed to access this file';
  end if;

  v_event := case p_action
    when 'download' then 'file_downloaded'::public.audit_event_type
    when 'print' then 'file_printed'::public.audit_event_type
    else 'file_previewed'::public.audit_event_type
  end;

  perform public.log_audit(
    v_event,
    'policy_files',
    v_file.id,
    v_file.policy_id,
    jsonb_build_object(
      'bucket_id', v_file.bucket_id,
      'storage_path', v_file.storage_path,
      'action', p_action
    )
  );

  return true;
end;
$$;

create or replace function public.mark_notification_read(p_notification_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.notifications
  set read_at = coalesce(read_at, now())
  where id = p_notification_id
    and recipient_id = auth.uid();

  if not found then
    raise exception 'notification not found';
  end if;

  perform public.log_audit(
    'notification_read',
    'notifications',
    p_notification_id,
    null,
    '{}'::jsonb
  );
end;
$$;

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
  if auth.uid() is null or public.current_app_role() <> 'system_admin' then
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

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists categories_updated_at on public.categories;
create trigger categories_updated_at
before update on public.categories
for each row execute function public.set_updated_at();

drop trigger if exists policies_updated_at on public.policies;
create trigger policies_updated_at
before update on public.policies
for each row execute function public.set_updated_at();

drop trigger if exists policy_versions_updated_at on public.policy_versions;
create trigger policy_versions_updated_at
before update on public.policy_versions
for each row execute function public.set_updated_at();

drop trigger if exists policy_metadata_updated_at on public.policy_metadata;
create trigger policy_metadata_updated_at
before update on public.policy_metadata
for each row execute function public.set_updated_at();

drop trigger if exists review_comments_updated_at on public.review_comments;
create trigger review_comments_updated_at
before update on public.review_comments
for each row execute function public.set_updated_at();

drop trigger if exists audit_logs_no_update on public.audit_logs;
create trigger audit_logs_no_update
before update or delete on public.audit_logs
for each row execute function public.prevent_audit_log_mutation();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- RLS enablement
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.policies enable row level security;
alter table public.policy_versions enable row level security;
alter table public.policy_files enable row level security;
alter table public.policy_metadata enable row level security;
alter table public.review_comments enable row level security;
alter table public.approval_actions enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;
alter table public.app_settings enable row level security;

-- ---------------------------------------------------------------------------
-- RLS policies
-- ---------------------------------------------------------------------------
drop policy if exists "profiles_select_allowed" on public.profiles;
create policy "profiles_select_allowed"
on public.profiles for select to authenticated
using (
  id = auth.uid()
  or public.current_app_role() in ('quality_manager', 'system_admin')
);

drop policy if exists "profiles_update_self_or_admin" on public.profiles;
drop policy if exists "profiles_update_admin_only" on public.profiles;
create policy "profiles_update_admin_only"
on public.profiles for update to authenticated
using (public.current_app_role() = 'system_admin')
with check (public.current_app_role() = 'system_admin');

drop policy if exists "categories_select_active" on public.categories;
create policy "categories_select_active"
on public.categories for select to authenticated
using (is_active or public.current_app_role() in ('quality_manager', 'system_admin'));

drop policy if exists "categories_admin_write" on public.categories;
create policy "categories_admin_write"
on public.categories for all to authenticated
using (public.current_app_role() = 'system_admin')
with check (public.current_app_role() = 'system_admin');

drop policy if exists "policies_select_allowed" on public.policies;
create policy "policies_select_allowed"
on public.policies for select to authenticated
using (public.can_access_policy_record(id));

drop policy if exists "policies_insert_staff_manager" on public.policies;
create policy "policies_insert_staff_manager"
on public.policies for insert to authenticated
with check (
  public.current_app_role() in ('quality_staff', 'quality_manager')
  and owner_id = auth.uid()
  and created_by = auth.uid()
);

drop policy if exists "policies_update_owner_or_manager" on public.policies;
drop policy if exists "policies_no_direct_update" on public.policies;
create policy "policies_no_direct_update"
on public.policies for update to authenticated
using (false)
with check (false);

drop policy if exists "policy_versions_select_allowed" on public.policy_versions;
create policy "policy_versions_select_allowed"
on public.policy_versions for select to authenticated
using (public.can_access_policy_record(policy_id));

drop policy if exists "policy_versions_insert_owner_manager" on public.policy_versions;
create policy "policy_versions_insert_owner_manager"
on public.policy_versions for insert to authenticated
with check (
  exists (
    select 1 from public.policies p
    where p.id = policy_id
      and (p.owner_id = auth.uid() or public.current_app_role() = 'quality_manager')
  )
);

drop policy if exists "policy_versions_update_owner_manager" on public.policy_versions;
drop policy if exists "policy_versions_no_direct_update" on public.policy_versions;
create policy "policy_versions_no_direct_update"
on public.policy_versions for update to authenticated
using (false)
with check (false);

drop policy if exists "policy_files_select_allowed" on public.policy_files;
create policy "policy_files_select_allowed"
on public.policy_files for select to authenticated
using (public.can_access_policy_record(policy_id));

drop policy if exists "policy_files_insert_owner_manager" on public.policy_files;
create policy "policy_files_insert_owner_manager"
on public.policy_files for insert to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1 from public.policies p
    where p.id = policy_id
      and (p.owner_id = auth.uid() or public.current_app_role() = 'quality_manager')
  )
);

drop policy if exists "policy_metadata_select_allowed" on public.policy_metadata;
create policy "policy_metadata_select_allowed"
on public.policy_metadata for select to authenticated
using (public.can_access_policy_record(policy_id));

drop policy if exists "policy_metadata_manager_admin_write" on public.policy_metadata;
create policy "policy_metadata_manager_admin_write"
on public.policy_metadata for all to authenticated
using (public.current_app_role() in ('quality_manager', 'system_admin'))
with check (public.current_app_role() in ('quality_manager', 'system_admin'));

drop policy if exists "review_comments_select_allowed" on public.review_comments;
create policy "review_comments_select_allowed"
on public.review_comments for select to authenticated
using (public.can_access_policy_record(policy_id));

drop policy if exists "review_comments_manager_insert" on public.review_comments;
create policy "review_comments_manager_insert"
on public.review_comments for insert to authenticated
with check (public.current_app_role() = 'quality_manager' and author_id = auth.uid());

drop policy if exists "approval_actions_select_allowed" on public.approval_actions;
create policy "approval_actions_select_allowed"
on public.approval_actions for select to authenticated
using (public.can_access_policy_record(policy_id));

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own"
on public.notifications for select to authenticated
using (recipient_id = auth.uid());

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own"
on public.notifications for update to authenticated
using (recipient_id = auth.uid())
with check (recipient_id = auth.uid());

drop policy if exists "audit_logs_select_manager_admin" on public.audit_logs;
create policy "audit_logs_select_manager_admin"
on public.audit_logs for select to authenticated
using (public.current_app_role() in ('quality_manager', 'system_admin'));

drop policy if exists "audit_logs_no_direct_insert" on public.audit_logs;
create policy "audit_logs_no_direct_insert"
on public.audit_logs for insert to authenticated
with check (false);

drop policy if exists "app_settings_select_active" on public.app_settings;
create policy "app_settings_select_active"
on public.app_settings for select to authenticated
using (public.is_active_profile());

drop policy if exists "app_settings_admin_write" on public.app_settings;
create policy "app_settings_admin_write"
on public.app_settings for all to authenticated
using (public.current_app_role() = 'system_admin')
with check (public.current_app_role() = 'system_admin');

-- ---------------------------------------------------------------------------
-- Storage buckets
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'policy-originals',
    'policy-originals',
    false,
    52428800,
    array[
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]
  ),
  (
    'policy-previews',
    'policy-previews',
    false,
    52428800,
    array['application/pdf']
  ),
  (
    'policy-approved',
    'policy-approved',
    false,
    52428800,
    array[
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]
  )
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- storage.objects policies
-- ---------------------------------------------------------------------------
drop policy if exists "policy_storage_insert_own_folder" on storage.objects;
create policy "policy_storage_insert_own_folder"
on storage.objects for insert to authenticated
with check (
  bucket_id in ('policy-originals', 'policy-previews', 'policy-approved')
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "policy_storage_select_authorized" on storage.objects;
create policy "policy_storage_select_authorized"
on storage.objects for select to authenticated
using (
  bucket_id in ('policy-originals', 'policy-previews', 'policy-approved')
  and exists (
    select 1
    from public.policy_files pf
    where pf.bucket_id = storage.objects.bucket_id
      and pf.storage_path = storage.objects.name
      and public.can_access_policy_content(pf.policy_id)
  )
);

drop policy if exists "policy_storage_update_own_unapproved" on storage.objects;
create policy "policy_storage_update_own_unapproved"
on storage.objects for update to authenticated
using (
  bucket_id in ('policy-originals', 'policy-previews', 'policy-approved')
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id in ('policy-originals', 'policy-previews', 'policy-approved')
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- ---------------------------------------------------------------------------
-- Function grants
-- ---------------------------------------------------------------------------
revoke all on function public.log_audit(public.audit_event_type, text, uuid, uuid, jsonb) from anon, authenticated;
grant execute on function public.submit_policy_version(uuid, uuid, text) to authenticated;
grant execute on function public.return_policy_for_revision(uuid, uuid, text, integer) to authenticated;
grant execute on function public.approve_policy_version(uuid, uuid) to authenticated;
grant execute on function public.archive_policy(uuid, text) to authenticated;
grant execute on function public.track_file_access(uuid, text) to authenticated;
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.admin_update_profile(uuid, text, public.app_role, public.profile_status, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Required seed/reference data only
-- ---------------------------------------------------------------------------
insert into public.app_settings (key, value, description)
values
  ('default_review_interval_months', '36'::jsonb, 'Default review interval when the policy document does not provide a review date.'),
  ('max_upload_size_mb', '50'::jsonb, 'Maximum browser upload size enforced by private Storage buckets.'),
  ('library_public_access', 'false'::jsonb, 'The v1 library is available after authentication only.'),
  ('word_download_scope', '"quality_staff_and_manager"'::jsonb, 'Approved Word download scope for v1.')
on conflict (key) do update
set value = excluded.value,
    description = excluded.description,
    updated_at = now();

insert into public.categories (kind, name_ar, name_en, code, sort_order)
values
  ('document_type', 'سياسة', 'Policy', 'policy', 10),
  ('document_type', 'إجراء', 'Procedure', 'procedure', 20),
  ('document_type', 'بروتوكول', 'Protocol', 'protocol', 30),
  ('document_type', 'دليل', 'Guide', 'guide', 40),
  ('document_type', 'نموذج', 'Form', 'form', 50),
  ('document_type', 'تعليمات عمل', 'Work Instruction', 'work_instruction', 60)
on conflict (kind, parent_id, name_ar) do update
set name_en = excluded.name_en,
    code = excluded.code,
    sort_order = excluded.sort_order,
    is_active = true,
    updated_at = now();

commit;
