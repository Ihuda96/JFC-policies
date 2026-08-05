-- JFC Policies Platform — V12: personal profile photo, any user
--
-- Run once in the Supabase SQL Editor. Safe to re-run.
--
-- The account badge in the topbar showed a single Arabic letter for
-- everyone. Lets any signed-in user upload their own photo instead; when
-- none is set, the app falls back to the JFHC star badge (not a letter).
--
-- profiles' own update RLS is admin-only (see profiles_update_admin_only),
-- so — same reasoning as set_ceo_stamp in V5 — this goes through a
-- SECURITY DEFINER RPC scoped to the caller's own row instead of widening
-- that policy.

begin;

alter table public.profiles add column if not exists avatar_path text;

-- The photo isn't sensitive, and is shown across the app (topbar,
-- approvals, admin lists) from client code that isn't always already
-- holding a fresh signed URL, so this bucket is public like ceo-stamps —
-- unguessable UUID-prefixed paths, not listable.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-avatars',
  'profile-avatars',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "profile_avatar_insert_own_folder" on storage.objects;
create policy "profile_avatar_insert_own_folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "profile_avatar_update_own_folder" on storage.objects;
create policy "profile_avatar_update_own_folder"
on storage.objects for update to authenticated
using (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "profile_avatar_delete_own_folder" on storage.objects;
create policy "profile_avatar_delete_own_folder"
on storage.objects for delete to authenticated
using (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Records which photo is the caller's own current avatar.
create or replace function public.set_profile_avatar(p_storage_path text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_active_profile() then
    raise exception 'active authenticated profile is required';
  end if;

  if nullif(trim(coalesce(p_storage_path, '')), '') is null then
    raise exception 'avatar path is required';
  end if;

  update public.profiles
  set avatar_path = trim(p_storage_path)
  where id = auth.uid();

  perform public.log_audit(
    'profile_updated',
    'profiles',
    auth.uid(),
    null,
    jsonb_build_object('avatar_updated', true)
  );
end;
$$;

grant execute on function public.set_profile_avatar(text) to authenticated;

-- Removes the caller's own avatar, reverting them to the default badge.
create or replace function public.clear_profile_avatar()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_active_profile() then
    raise exception 'active authenticated profile is required';
  end if;

  update public.profiles
  set avatar_path = null
  where id = auth.uid();

  perform public.log_audit(
    'profile_updated',
    'profiles',
    auth.uid(),
    null,
    jsonb_build_object('avatar_removed', true)
  );
end;
$$;

grant execute on function public.clear_profile_avatar() to authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
