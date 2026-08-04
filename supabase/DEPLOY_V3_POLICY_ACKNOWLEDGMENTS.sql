-- JFC Policies Platform — V3: policy acknowledgment gate
--
-- Run once in the Supabase SQL Editor. Safe to re-run.
--
-- Lets a viewer confirm "I have read and understood this policy" for the
-- currently approved version, and lets the policy's owner/manager or the
-- quality team see who has and hasn't acknowledged it yet. Acknowledgments
-- are tied to a specific version_id, so a new approved version resets the
-- gate — an acknowledgment of an older text never counts for a newer one.

begin;

create table if not exists public.policy_acknowledgments (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.policies(id) on delete cascade,
  version_id uuid not null references public.policy_versions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  constraint policy_acknowledgments_unique unique (policy_id, user_id, version_id)
);

create index if not exists policy_acknowledgments_policy_idx
  on public.policy_acknowledgments (policy_id);
create index if not exists policy_acknowledgments_user_idx
  on public.policy_acknowledgments (user_id);

alter table public.policy_acknowledgments enable row level security;

drop policy if exists "policy_acknowledgments_select_own" on public.policy_acknowledgments;
create policy "policy_acknowledgments_select_own"
on public.policy_acknowledgments for select to authenticated
using (user_id = auth.uid());

drop policy if exists "policy_acknowledgments_select_manager" on public.policy_acknowledgments;
create policy "policy_acknowledgments_select_manager"
on public.policy_acknowledgments for select to authenticated
using (
  public.current_app_role() in ('quality_manager', 'system_admin')
  or exists (
    select 1
    from public.policies p
    where p.id = policy_acknowledgments.policy_id
      and (p.owner_id = auth.uid() or p.assigned_manager_id = auth.uid())
  )
);

drop policy if exists "policy_acknowledgments_no_direct_insert" on public.policy_acknowledgments;
create policy "policy_acknowledgments_no_direct_insert"
on public.policy_acknowledgments for insert to authenticated
with check (false);

create or replace function public.acknowledge_policy(p_policy_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_policy public.policies;
begin
  if auth.uid() is null or not public.is_active_profile() then
    raise exception 'authentication required';
  end if;

  select * into v_policy from public.policies where id = p_policy_id;
  if not found then
    raise exception 'policy not found';
  end if;

  if not public.can_access_policy_record(p_policy_id) then
    raise exception 'not authorized to view this policy';
  end if;

  if v_policy.status <> 'approved' or v_policy.approved_version_id is null then
    raise exception 'only approved policies can be acknowledged';
  end if;

  insert into public.policy_acknowledgments (policy_id, version_id, user_id)
  values (p_policy_id, v_policy.approved_version_id, auth.uid())
  on conflict (policy_id, user_id, version_id) do nothing;
end;
$$;

grant execute on function public.acknowledge_policy(uuid) to authenticated;

commit;
