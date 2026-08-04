-- JFC Policies Platform — V5: CEO e-stamp on final approval
--
-- Run once in the Supabase SQL Editor. Safe to re-run.
--
-- Gives the executive office a real digital stamp: the CEO uploads an
-- e-stamp image once (from an icon in the executive portal), and from then
-- on, every policy they finally approve — single or in bulk — is
-- automatically marked with a snapshot of that stamp. The snapshot is
-- taken at the moment of approval, not a live pointer back to the CEO's
-- profile, so changing the stamp later never silently alters an
-- already-finalised policy's record.

begin;

alter table public.profiles add column if not exists stamp_path text;
alter table public.profiles add column if not exists stamp_updated_at timestamptz;

alter table public.policies add column if not exists final_stamp_path text;

-- The stamp graphic itself isn't sensitive — a seal design, not policy
-- content — and the anonymous section-barcode library needs to display it
-- without an authenticated session, so this bucket is public, unlike the
-- policy document buckets.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ceo-stamps',
  'ceo-stamps',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "ceo_stamp_insert_own_folder" on storage.objects;
create policy "ceo_stamp_insert_own_folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'ceo-stamps'
  and public.is_ceo()
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "ceo_stamp_update_own_folder" on storage.objects;
create policy "ceo_stamp_update_own_folder"
on storage.objects for update to authenticated
using (
  bucket_id = 'ceo-stamps'
  and public.is_ceo()
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'ceo-stamps'
  and public.is_ceo()
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Records which stamp image is the CEO's current one.
create or replace function public.set_ceo_stamp(p_storage_path text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_ceo() then
    raise exception 'executive role is required';
  end if;

  if nullif(trim(coalesce(p_storage_path, '')), '') is null then
    raise exception 'stamp path is required';
  end if;

  update public.profiles
  set stamp_path = trim(p_storage_path),
      stamp_updated_at = now()
  where id = auth.uid();

  perform public.log_audit(
    'profile_updated',
    'profiles',
    auth.uid(),
    null,
    jsonb_build_object('stamp_updated', true)
  );
end;
$$;

grant execute on function public.set_ceo_stamp(text) to authenticated;

-- Single final approval — now also stamps the policy with the approving
-- CEO's current e-stamp, if one is on file.
create or replace function public.ceo_final_approve(p_policy_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_policy public.policies;
  v_stamp text;
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

  select stamp_path into v_stamp from public.profiles where id = v_actor;

  update public.policies
  set final_approved_at = now(),
      final_approved_by = v_actor,
      final_stamp_path = v_stamp,
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
    jsonb_build_object('final_approval', true, 'stamped', v_stamp is not null)
  );
end;
$$;

grant execute on function public.ceo_final_approve(uuid) to authenticated;

-- Bulk final approval — same stamp snapshot, applied across the batch.
create or replace function public.ceo_final_approve_all()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_count integer := 0;
  v_stamp text;
begin
  if v_actor is null or not public.is_ceo() then
    raise exception 'executive role is required';
  end if;

  select stamp_path into v_stamp from public.profiles where id = v_actor;

  create temporary table _final_approved_batch on commit drop as
  with updated as (
    update public.policies
    set final_approved_at = now(),
        final_approved_by = v_actor,
        final_stamp_path = v_stamp,
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
      jsonb_build_object('bulk_final_approval', true, 'count', v_count, 'stamped', v_stamp is not null)
    );
  end if;

  return v_count;
end;
$$;

grant execute on function public.ceo_final_approve_all() to authenticated;

-- Returning a finalised policy clears its stamp along with its final
-- approval — a returned policy is no longer officially sealed.
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
      final_stamp_path = null,
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

grant execute on function public.ceo_return_policy(uuid, text) to authenticated;

-- Public section library: also surface the stamp, so a phone scanning a
-- department QR code sees the same seal of authenticity. Changing a
-- returns-table shape requires dropping the function first.
drop function if exists public.open_section_library(text, text);
create or replace function public.open_section_library(p_code text, p_access_code text)
returns table (
  id uuid,
  title text,
  policy_number text,
  approved_at timestamptz,
  final_approved_at timestamptz,
  next_review_at date,
  department_code text,
  final_stamp_path text
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
         public.policy_department_code(p.policy_number, p.owner_department) as department_code,
         p.final_stamp_path
  from public.policies p, target t
  where p.final_approved_at is not null
    and p.status = 'approved'
    and (
      public.policy_department_code(p.policy_number, p.owner_department) = t.code
      or upper(split_part(coalesce(p.policy_number, ''), '-', 3)) = t.code
    )
  order by p.final_approved_at desc
$$;

grant execute on function public.open_section_library(text, text) to anon, authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
