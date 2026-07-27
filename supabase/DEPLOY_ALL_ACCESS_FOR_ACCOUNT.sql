-- JFC Policies Platform — grant ONE account combined access
-- (quality employee + quality manager + system admin) at the same time.
--
-- Safe to run in the Supabase SQL Editor. No service-role key required.
-- Idempotent: re-running it is harmless.
--
-- HOW IT WORKS
-- The platform gives each user a single role, and the three roles are
-- mutually exclusive in the database (approving needs exactly
-- quality_manager, user management needs exactly system_admin, authoring
-- needs quality_staff/quality_manager). A "platform super admin" already
-- maps to system_admin via public.system_admin_overrides, which covers the
-- admin side. This script additionally lets a platform super admin satisfy
-- the MANAGER and AUTHOR gates too — so the designated account can do
-- everything at once. Only emails in public.system_admin_overrides are
-- affected; every other user keeps their normal single role.
--
-- The target account must already exist in Supabase Auth (the person has
-- signed up / been created) and sign in with the email below.

begin;

-- ── 1. Capability predicates ────────────────────────────────────────────
-- "Acts as a quality manager" = actually a quality manager, OR a designated
-- platform super admin (email allowlist / super-admin JWT claim).
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

-- "Can author policies" = quality staff or quality manager, OR a designated
-- platform super admin.
create or replace function public.can_author_policies()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_app_role() in ('quality_staff', 'quality_manager')
      or public.is_platform_superadmin()
$$;

grant execute on function public.acts_as_quality_manager() to authenticated;
grant execute on function public.can_author_policies() to authenticated;

-- ── 2. Broaden the manager-exclusive gates ──────────────────────────────
-- Content access (file preview/download) for non-owned, non-approved policies.
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
        or p.status = 'approved'
      )
  )
$$;

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

-- Return a policy for revision (manager decision).
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
  if v_actor is null or not public.acts_as_quality_manager() then
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

-- Approve and publish a policy version (manager decision).
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
  if v_actor is null or not public.acts_as_quality_manager() then
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

-- ── 3. Broaden the author / manager RLS write gates ─────────────────────
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
      and (p.owner_id = auth.uid() or public.acts_as_quality_manager())
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
      and (p.owner_id = auth.uid() or public.acts_as_quality_manager())
  )
);

drop policy if exists "review_comments_manager_insert" on public.review_comments;
create policy "review_comments_manager_insert"
on public.review_comments for insert to authenticated
with check (public.acts_as_quality_manager() and author_id = auth.uid());

-- ── 4. Designate the account (email allowlist) ──────────────────────────
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
