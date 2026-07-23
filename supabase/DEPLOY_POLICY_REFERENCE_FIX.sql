-- Adds set_policy_reference so the app can store the full policy code
-- (e.g. JFHC-HRD-HPD-APP-PP-01) read from the document. Direct updates to
-- policies are blocked by RLS, so this security-definer function performs the
-- controlled update after checking permissions.
-- Safe to run in the Supabase SQL Editor. No service-role key is required.

begin;

create or replace function public.set_policy_reference(
  p_policy_id uuid,
  p_reference text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_policy public.policies%rowtype;
  v_reference text := nullif(trim(coalesce(p_reference, '')), '');
begin
  if v_actor is null or not public.is_active_profile() then
    raise exception 'active authenticated profile is required';
  end if;

  if v_reference is null then
    return;
  end if;

  select * into v_policy
  from public.policies
  where id = p_policy_id
  for update;

  if not found then
    raise exception 'policy not found';
  end if;

  -- Any active employee may set or correct the policy code/number.
  -- Overwrite is allowed so a rescan can correct a previously stored code.
  if v_reference = coalesce(v_policy.policy_number, '') then
    return;
  end if;

  update public.policies
  set policy_number = v_reference,
      updated_at = now()
  where id = p_policy_id;
end;
$$;

grant execute on function public.set_policy_reference(uuid, text) to authenticated;
notify pgrst, 'reload schema';

commit;
