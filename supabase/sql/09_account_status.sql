-- Shows who has verified their email and who has not (Accounts page, Status column).
-- Run once in the Supabase SQL Editor. Safe to run again.

create or replace function public.account_statuses() returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform public.need_role(array['admin']);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', u.id, 'verified_at', u.email_confirmed_at, 'last_sign_in_at', u.last_sign_in_at, 'invited_at', u.invited_at))
      from auth.users u join public.accounts a on a.id = u.id), '[]'::jsonb);
end $$;

revoke all on function public.account_statuses() from public, anon;
grant execute on function public.account_statuses() to authenticated;
