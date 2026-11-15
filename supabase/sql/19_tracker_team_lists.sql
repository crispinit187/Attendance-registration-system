-- The team of a tracker event now includes people given ONE list of it, not just the whole event.
-- Each person given a single list comes back with that list's name. Run AFTER 18_started_dates.sql.
-- Safe to run again.

create or replace function public.tracker_team(p_event uuid, p_list uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r text;
begin
  r := public.need_role(array['admin', 'manager', 'list_manager']);
  if r <> 'admin' and not (case when p_list is not null then public.tracker_list_access(p_list) else public.tracker_event_access(p_event) end) then
    raise exception 'You do not have access to that.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'grant_id', g.id, 'account_id', a.id,
             'name', coalesce(nullif(a.full_name, ''), a.email),
             'email', case when r = 'admin' then a.email else null end,
             'role', a.role, 'disabled', a.disabled,
             'level', case when g.tracker_list_id is not null then 'list' else 'event' end,
             'list_id', tl.id, 'list_title', tl.title)
           order by (g.tracker_list_id is null) desc, (a.role in ('manager', 'list_manager')) desc, a.role,
                    coalesce(nullif(a.full_name, ''), a.email), tl.title)
      from public.reviewer_grants g
      join public.accounts a on a.id = g.account_id
      left join public.tracker_lists tl on tl.id = g.tracker_list_id
     where (p_list is null and (g.tracker_event_id = p_event or tl.event_id = p_event))
        or (p_list is not null and (g.tracker_list_id = p_list or g.tracker_event_id = p_event))), '[]'::jsonb);
end $$;
grant execute on function public.tracker_team(uuid, uuid) to authenticated;
