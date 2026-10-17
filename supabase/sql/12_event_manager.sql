-- Event manager: a new kind of account for people who run some events and sign-up lists.
-- The admin chooses which events and sign-up lists each manager can work with. Within those they can
-- create and manage lists and sign-up lists, open and close registration, mark attendance, add and remove
-- people, see contact numbers and export. They cannot create events, and they have no Accounts, Setup,
-- Districts or Audit log. Run once in the Supabase SQL Editor, after 01 to 11. Safe to run again.

-- 1. The new role
alter table public.accounts drop constraint if exists accounts_role_check;
alter table public.accounts add constraint accounts_role_check
  check (role in ('admin','manager','reviewer','registrar','member'));

-- 2. Functions
create or replace function public.list_access(p_list uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.accounts a
    where a.id = auth.uid() and not a.disabled
      and (a.role = 'admin'
           or (a.role in ('registrar', 'reviewer', 'manager')
               and ((a.access_scope = 'all' and a.role <> 'manager')
                    or exists (select 1 from public.reviewer_grants g
                               where g.account_id = a.id
                                 and (g.list_id = p_list
                                      or g.event_id = (select l.event_id from public.lists l where l.id = p_list))))))
  )
$$;

create or replace function public.event_access(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.accounts a
    where a.id = auth.uid() and not a.disabled
      and (a.role = 'admin'
           or (a.role in ('registrar', 'reviewer', 'manager')
               and ((a.access_scope = 'all' and a.role <> 'manager')
                    or exists (select 1 from public.reviewer_grants g
                               where g.account_id = a.id
                                 and (g.event_id = p_event
                                      or g.list_id in (select l.id from public.lists l where l.event_id = p_event))))))
  )
$$;

create or replace function public.signup_access(p_signup uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.accounts a
    where a.id = auth.uid() and not a.disabled
      and (a.role = 'admin'
           or (a.role in ('registrar', 'manager')
               and ((a.access_scope = 'all' and a.role <> 'manager')
                    or exists (select 1 from public.reviewer_grants g
                               where g.account_id = a.id and g.signup_list_id = p_signup))))
  )
$$;

create or replace function public.can_review_list(p_list uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_role() in ('reviewer', 'manager') and public.list_access(p_list)
$$;

create or replace function public.can_review_event(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_role() in ('reviewer', 'manager') and public.event_access(p_event)
$$;

create or replace function public.mark_attendance_manual(p_list uuid, p_person uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r text; l public.lists%rowtype; pr public.people%rowtype; method text;
begin
  r := public.need_role(array['admin', 'registrar', 'manager']);
  perform public.rate_check('mark_manual', 120, 60);
  select * into l from public.lists where id = p_list;
  if not found or l.status <> 'open' then raise exception 'Registration is closed.'; end if;
  if r in ('registrar', 'manager') and not public.list_access(p_list) then raise exception 'You do not have access to this list.'; end if;
  select * into pr from public.people where id = p_person and not archived;
  if not found then raise exception 'Person not found.'; end if;
  if r = 'registrar' and cardinality(l.allowed_area_ids) > 0
     and not (pr.area_id = any (l.allowed_area_ids)) then
    raise exception 'This list is not open to that person''s area.';
  end if;
  method := case when r = 'admin' then 'admin' else 'registrar' end;
  return public._put_attendance(l.id, pr.id, method, true);
end $$;

create or replace function public.remove_attendance(p_att uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r text; a public.attendance%rowtype; l public.lists%rowtype;
begin
  r := public.need_role(array['admin', 'registrar', 'manager']);
  perform public.rate_check('remove', 60, 60);
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'Please give a reason for removing this attendee.';
  end if;
  select * into a from public.attendance where id = p_att;
  if not found then raise exception 'Attendance record not found.'; end if;
  if a.removed then return; end if;
  select * into l from public.lists where id = a.list_id;
  if r in ('registrar', 'manager') and not public.list_access(a.list_id) then raise exception 'You do not have access to this list.'; end if;
  if l.status = 'archived' then raise exception 'This list is archived.'; end if;
  update public.attendance
     set removed = true, removed_by = auth.uid(), removed_at = now(), removed_reason = btrim(p_reason)
   where id = a.id;
  perform public.log_action('attendance.remove', 'list', a.list_id::text,
    jsonb_build_object('list_title', l.title, 'person', a.snapshot->>'display_name',
                       'person_id', a.person_id, 'reason', btrim(p_reason)));
end $$;

create or replace function public.restore_attendance(p_att uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r text; a public.attendance%rowtype; l public.lists%rowtype;
begin
  r := public.need_role(array['admin', 'registrar', 'manager']);
  select * into a from public.attendance where id = p_att;
  if not found then raise exception 'Attendance record not found.'; end if;
  if not a.removed then return; end if;
  select * into l from public.lists where id = a.list_id;
  if r in ('registrar', 'manager') and not public.list_access(a.list_id) then raise exception 'You do not have access to this list.'; end if;
  if l.status = 'archived' then raise exception 'This list is archived.'; end if;
  update public.attendance
     set removed = false, removed_by = null, removed_at = null, removed_reason = null
   where id = a.id;
  perform public.log_action('attendance.restore', 'list', a.list_id::text,
    jsonb_build_object('list_title', l.title, 'person', a.snapshot->>'display_name',
                       'person_id', a.person_id));
end $$;

create or replace function public.list_present(p_list uuid, p_include_removed boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare r text; l public.lists%rowtype; res jsonb;
begin
  r := public.need_role(array['admin', 'registrar', 'manager']);
  select * into l from public.lists where id = p_list;
  if not found then raise exception 'List not found.'; end if;
  if r = 'registrar' and (l.status <> 'open' or not public.list_access(p_list)) then
    raise exception 'You can only see an open list that you have access to.';
  end if;
  if r = 'manager' and not public.list_access(p_list) then raise exception 'You do not have access to this list.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'att_id', at.id,
      'person_id', at.person_id,
      'display_name', at.snapshot->>'display_name',
      'area', at.snapshot->>'area',
      'district', at.snapshot->>'district',
      'voice_part', at.snapshot->>'voice_part',
      'marked_at', at.marked_at,
      'method', at.method,
      'marked_by', at.marked_by,
      'marked_by_name', at.marked_by_name,
      'removed', at.removed,
      'removed_reason', at.removed_reason) order by at.marked_at desc), '[]'::jsonb)
    into res
    from public.attendance at
   where at.list_id = p_list and (p_include_removed or not at.removed);
  return res;
end $$;

create or replace function public.search_people(p_q text, p_list uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare q text := btrim(coalesce(p_q, '')); res jsonb;
begin
  perform public.need_role(array['admin', 'registrar', 'manager']);
  if char_length(q) < 2 then return '[]'::jsonb; end if;
  q := left(q, 60);
  select coalesce(jsonb_agg(public._person_card(x.id, p_list) order by x.score desc, x.full_name), '[]'::jsonb)
    into res
    from (
      select p.id, p.full_name, similarity(p.full_name, q) as score
        from public.people p
       where not p.archived
         and (p.full_name ilike '%' || replace(replace(q, '%', ''), '_', '') || '%'
              or similarity(p.full_name, q) >= 0.3)
       order by similarity(p.full_name, q) desc, p.full_name
       limit 12
    ) x;
  return res;
end $$;

create or replace function public.create_person(
  p_title_id uuid, p_title_specify text, p_full_name text, p_area_id uuid,
  p_voice_part_id uuid, p_district text, p_contact text, p_force boolean default false
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare nm text; spec text; dg uuid; c text; pid uuid; sim_matches jsonb;
begin
  perform public.need_role(array['admin', 'registrar', 'manager']);
  perform public.rate_check('create_person', 30, 60);
  nm := btrim(p_full_name);
  if char_length(nm) < 2 then raise exception 'Please enter the full name.'; end if;

  if not p_force then
    select coalesce(jsonb_agg(public._person_card(x.id, null) order by x.score desc), '[]'::jsonb)
      into sim_matches
      from (
        select p.id, similarity(p.full_name, nm) as score
          from public.people p
         where not p.archived and similarity(p.full_name, nm) >= 0.5
         order by similarity(p.full_name, nm) desc limit 5
      ) x;
    if jsonb_array_length(sim_matches) > 0 then
      return jsonb_build_object('status', 'similar', 'matches', sim_matches);
    end if;
  end if;

  spec := public._clean_specify(p_title_id, p_title_specify);
  perform public._check_lookups(p_area_id, p_voice_part_id);
  dg := public.resolve_district(p_district);
  c := public.normalize_contact(p_contact);
  insert into public.people (title_id, title_specify, full_name, area_id, district_group_id,
                             voice_part_id, contact, created_by)
  values (p_title_id, spec, nm, p_area_id, dg, p_voice_part_id, c, auth.uid())
  returning id into pid;
  return jsonb_build_object('status', 'created', 'id', pid);
end $$;

create or replace function public.update_person(
  p_id uuid, p_title_id uuid, p_title_specify text, p_full_name text, p_area_id uuid,
  p_voice_part_id uuid, p_district text, p_contact text
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r text; pr public.people%rowtype; spec text; dg uuid; c text; nm text;
begin
  r := public.need_role(array['admin', 'registrar', 'manager']);
  select * into pr from public.people where id = p_id;
  if not found then raise exception 'Person not found.'; end if;
  if r in ('registrar', 'manager') and pr.created_by is distinct from auth.uid() then
    raise exception 'You can only edit people you added.';
  end if;
  nm := btrim(p_full_name);
  if char_length(nm) < 2 then raise exception 'Please enter the full name.'; end if;
  spec := public._clean_specify(p_title_id, p_title_specify);
  perform public._check_lookups(p_area_id, p_voice_part_id);
  dg := public.resolve_district(p_district);
  c := public.normalize_contact(p_contact);
  update public.people
     set title_id = p_title_id, title_specify = spec, full_name = nm, area_id = p_area_id,
         district_group_id = dg, voice_part_id = p_voice_part_id, contact = c, updated_at = now()
   where id = p_id;
end $$;

create or replace function public.archive_person(p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r text; pr public.people%rowtype;
begin
  r := public.need_role(array['admin', 'registrar', 'manager']);
  select * into pr from public.people where id = p_id;
  if not found then raise exception 'Person not found.'; end if;
  if r in ('registrar', 'manager') and pr.created_by is distinct from auth.uid() then
    raise exception 'You can only archive people you added.';
  end if;
  update public.people set archived = true, updated_at = now() where id = p_id;
  perform public.log_action('person.archive', 'person', p_id::text,
    jsonb_build_object('person', pr.full_name));
end $$;

create or replace function public.delete_person(p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r text; pr public.people%rowtype;
begin
  r := public.need_role(array['admin', 'registrar', 'manager']);
  select * into pr from public.people where id = p_id;
  if not found then raise exception 'Person not found.'; end if;
  if r in ('registrar', 'manager') and pr.created_by is distinct from auth.uid() then
    raise exception 'You can only delete people you added.';
  end if;
  if exists (select 1 from public.attendance where person_id = p_id) then
    raise exception 'This person has attendance history. Archive them instead.';
  end if;
  if exists (select 1 from public.accounts where person_id = p_id) then
    raise exception 'This person has a login account. Archive them instead.';
  end if;
  delete from public.people where id = p_id;
  perform public.log_action('person.delete', 'person', p_id::text,
    jsonb_build_object('person', pr.full_name));
end $$;

create or replace function public.save_list(
  p_id uuid, p_event uuid, p_title text, p_allowed uuid[],
  p_location boolean, p_lat double precision, p_lng double precision, p_radius int,
  p_rotating boolean, p_rotation int
) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare r text; lid uuid; cur public.lists%rowtype; allowed uuid[] := coalesce(p_allowed, '{}');
begin
  r := public.need_role(array['admin', 'manager']);
  if char_length(btrim(coalesce(p_title, ''))) < 2 then raise exception 'Please enter a list title.'; end if;
  if (select count(*) from public.areas where id = any (allowed)) <> cardinality(allowed) then
    raise exception 'One of the chosen areas does not exist.';
  end if;
  if p_location and (p_lat is null or p_lng is null) then
    raise exception 'Set the venue location, or turn the location check off.';
  end if;
  if p_id is null then
    if not exists (select 1 from public.events where id = p_event) then raise exception 'Event not found.'; end if;
    if r = 'manager' and not public.event_access(p_event) then raise exception 'You do not have access to this event.'; end if;
    if exists (select 1 from public.events where id = p_event and archived_at is not null) then
      raise exception 'This event is archived. Restore it before adding lists.';
    end if;
    insert into public.lists (event_id, title, allowed_area_ids, location_check, venue_lat, venue_lng,
                              radius_m, rotating_qr, rotation_seconds, created_by)
    values (p_event, btrim(p_title), allowed, p_location, p_lat, p_lng,
            coalesce(p_radius, 200), p_rotating, coalesce(p_rotation, 30), auth.uid())
    returning id into lid;
    perform public.log_action('list.create', 'list', lid::text, jsonb_build_object('title', btrim(p_title)));
  else
    select * into cur from public.lists where id = p_id;
    if not found then raise exception 'List not found.'; end if;
    if r = 'manager' and not public.list_access(p_id) then raise exception 'You do not have access to this list.'; end if;
    if cur.status = 'archived' then raise exception 'Restore this list from the archive before editing it.'; end if;
    update public.lists
       set title = btrim(p_title), allowed_area_ids = allowed, location_check = p_location,
           venue_lat = p_lat, venue_lng = p_lng, radius_m = coalesce(p_radius, 200),
           rotating_qr = p_rotating, rotation_seconds = coalesce(p_rotation, 30)
     where id = p_id;
    lid := p_id;
  end if;
  return lid;
end $$;

create or replace function public.open_list(p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r text; l public.lists%rowtype; o public.lists%rowtype;
begin
  r := public.need_role(array['admin', 'manager']);
  if r = 'manager' and not public.list_access(p_id) then raise exception 'You do not have access to this list.'; end if;
  select * into l from public.lists where id = p_id for update;
  if not found then raise exception 'List not found.'; end if;
  if l.status = 'open' then return; end if;
  if l.status = 'archived' then raise exception 'Restore this list from the archive before opening it.'; end if;
  if exists (select 1 from public.events where id = l.event_id and archived_at is not null) then
    raise exception 'This list belongs to an archived event. Restore the event first.';
  end if;
  update public.lists set status = 'open', opened_at = now(), closed_at = null where id = p_id;
  perform public.log_action('list.open', 'list', p_id::text, jsonb_build_object('title', l.title));
end $$;

create or replace function public.close_list(p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r text; l public.lists%rowtype;
begin
  r := public.need_role(array['admin', 'manager']);
  if r = 'manager' and not public.list_access(p_id) then raise exception 'You do not have access to this list.'; end if;
  select * into l from public.lists where id = p_id for update;
  if not found then raise exception 'List not found.'; end if;
  if l.status <> 'open' then return; end if;
  update public.lists set status = 'closed', closed_at = now() where id = p_id;
  perform public.log_action('list.close', 'list', p_id::text, jsonb_build_object('title', l.title));
end $$;

create or replace function public.archive_list(p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r text; l public.lists%rowtype;
begin
  r := public.need_role(array['admin', 'manager']);
  if r = 'manager' and not public.list_access(p_id) then raise exception 'You do not have access to this list.'; end if;
  select * into l from public.lists where id = p_id for update;
  if not found then raise exception 'List not found.'; end if;
  if l.status = 'open' then raise exception 'Close this list before archiving it.'; end if;
  if l.status = 'archived' then return; end if;
  update public.lists set status = 'archived', archived_at = now() where id = p_id;
  perform public.log_action('list.archive', 'list', p_id::text, jsonb_build_object('title', l.title));
end $$;

create or replace function public.unarchive_list(p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r text; l public.lists%rowtype;
begin
  r := public.need_role(array['admin', 'manager']);
  if r = 'manager' and not public.list_access(p_id) then raise exception 'You do not have access to this list.'; end if;
  select * into l from public.lists where id = p_id for update;
  if not found then raise exception 'List not found.'; end if;
  if l.status <> 'archived' then return; end if;
  update public.lists
     set status = case when opened_at is null then 'draft' else 'closed' end, archived_at = null
   where id = p_id;
  perform public.log_action('list.unarchive', 'list', p_id::text, jsonb_build_object('title', l.title));
end $$;

create or replace function public.delete_list(p_id uuid, p_confirm text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r text; l public.lists%rowtype; n int; ev text;
begin
  r := public.need_role(array['admin', 'manager']);
  if r = 'manager' and not public.list_access(p_id) then raise exception 'You do not have access to this list.'; end if;
  select * into l from public.lists where id = p_id for update;
  if not found then raise exception 'List not found.'; end if;
  if l.status <> 'archived' then raise exception 'Archive this list before deleting it.'; end if;
  if btrim(coalesce(p_confirm, '')) <> l.title then
    raise exception 'The typed title does not match. Nothing was deleted.';
  end if;
  select count(*) into n from public.attendance where list_id = p_id;
  select name into ev from public.events where id = l.event_id;
  delete from public.lists where id = p_id;
  perform public.log_action('list.delete', 'list', p_id::text,
    jsonb_build_object('title', l.title, 'event', ev, 'attendance_records', n));
end $$;

create or replace function public.get_qr_payload(p_list uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r text; l public.lists%rowtype; s public.list_secrets%rowtype; w bigint; secs int;
begin
  r := public.need_role(array['admin', 'registrar', 'manager']);
  perform public.rate_check('qr', 120, 60);
  select * into l from public.lists where id = p_list;
  if not found then raise exception 'List not found.'; end if;
  if r in ('registrar', 'manager') and not public.list_access(p_list) then raise exception 'You do not have access to this list.'; end if;
  select * into s from public.list_secrets where list_id = p_list;
  if l.rotating_qr then
    if l.status <> 'open' then raise exception 'This list is not open.'; end if;
    w := floor(extract(epoch from now()) / l.rotation_seconds)::bigint;
    secs := l.rotation_seconds - (extract(epoch from now())::bigint % l.rotation_seconds)::int;
    return jsonb_build_object('mode', 'rotating', 'token', public.rot_code(s.rotation_secret, w),
                              'seconds_left', secs, 'rotation_seconds', l.rotation_seconds,
                              'list_id', l.id, 'title', l.title);
  end if;
  if r not in ('admin', 'manager') then
    raise exception 'Rotating QR is off for this list. Only admins can show the printable QR code.';
  end if;
  return jsonb_build_object('mode', 'static', 'token', s.qr_token, 'list_id', l.id, 'title', l.title);
end $$;

create or replace function public.log_export(p_scope text, p_target uuid, p_format text, p_details jsonb default '{}'::jsonb)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r text; ok boolean; title text;
begin
  r := public.need_role(array['admin', 'reviewer', 'manager']);
  if p_scope not in ('list', 'event', 'signup') then raise exception 'Unknown export scope.'; end if;
  if p_scope = 'signup' and r not in ('admin', 'manager') then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  if r in ('reviewer', 'manager') then
    ok := case when p_scope = 'list' then public.can_review_list(p_target)
                when p_scope = 'signup' then public.signup_access(p_target)
                else public.can_review_event(p_target) end;
    if not ok then raise exception 'You do not have access to that.' using errcode = '42501'; end if;
  end if;
  if p_scope = 'list' then
    select l.title into title from public.lists l where l.id = p_target;
  elsif p_scope = 'signup' then
    select l.title into title from public.signup_lists l where l.id = p_target;
  else
    select e.name into title from public.events e where e.id = p_target;
  end if;
  perform public.log_action('export', p_scope, p_target::text,
    coalesce(p_details, '{}'::jsonb) || jsonb_build_object('format', p_format, 'name', title));
end $$;

create or replace function public.event_breakdown(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r text; res jsonb;
begin
  r := public.need_role(array['admin', 'reviewer', 'manager']);
  if r in ('reviewer', 'manager') and not public.can_review_event(p_event) then
    raise exception 'You do not have access to that.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.sort_at), '[]'::jsonb) into res
  from (
    select l.id as list_id, l.title, l.status, l.opened_at,
           coalesce(l.opened_at, l.created_at) as sort_at,
           (select count(*) from public.attendance a where a.list_id = l.id and not a.removed) as total,
           (select coalesce(jsonb_object_agg(k, c), '{}'::jsonb) from (
              select coalesce(a.snapshot->>'area', 'Unknown') as k, count(*) as c
                from public.attendance a where a.list_id = l.id and not a.removed group by 1) s) as areas,
           (select coalesce(jsonb_object_agg(k, c), '{}'::jsonb) from (
              select coalesce(a.snapshot->>'voice_part', 'Unknown') as k, count(*) as c
                from public.attendance a where a.list_id = l.id and not a.removed group by 1) s) as voices,
           (select coalesce(jsonb_object_agg(k, c), '{}'::jsonb) from (
              select coalesce(a.snapshot->>'district', 'Unknown') as k, count(*) as c
                from public.attendance a where a.list_id = l.id and not a.removed group by 1) s) as districts
      from public.lists l
     where l.event_id = p_event and l.status <> 'archived'
       and (r = 'admin' or public.can_review_list(l.id))
  ) x;
  return res;
end $$;

create or replace function public.event_team(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r text;
begin
  r := public.need_role(array['admin', 'manager']);
  if r = 'manager' and not public.event_access(p_event) then
    raise exception 'You do not have access to that.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'grant_id', g.id, 'account_id', a.id,
             'name', coalesce(nullif(a.full_name, ''), a.email),
             'email', case when r = 'admin' then a.email else null end,
             'role', a.role, 'disabled', a.disabled)
           order by (a.role = 'manager') desc, coalesce(nullif(a.full_name, ''), a.email))
      from public.reviewer_grants g join public.accounts a on a.id = g.account_id
     where g.event_id = p_event), '[]'::jsonb);
end $$;

create or replace function public.signup_team(p_signup uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r text;
begin
  r := public.need_role(array['admin', 'manager']);
  if r = 'manager' and not public.signup_access(p_signup) then
    raise exception 'You do not have access to that.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'grant_id', g.id, 'account_id', a.id,
             'name', coalesce(nullif(a.full_name, ''), a.email),
             'email', case when r = 'admin' then a.email else null end,
             'role', a.role, 'disabled', a.disabled)
           order by (a.role = 'manager') desc, coalesce(nullif(a.full_name, ''), a.email))
      from public.reviewer_grants g join public.accounts a on a.id = g.account_id
     where g.signup_list_id = p_signup), '[]'::jsonb);
end $$;

create or replace function public.signup_lists_overview() returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare r text;
begin
  r := public.need_role(array['admin', 'registrar', 'manager']);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', l.id, 'title', l.title, 'status', l.status, 'opened_at', l.opened_at,
             'created_at', l.created_at,
             'entries', (select count(*) from public.signup_entries e where e.list_id = l.id and not e.removed))
           order by (l.status = 'open') desc, l.created_at desc)
      from public.signup_lists l
     where r = 'admin'
        or (r = 'manager' and public.signup_access(l.id))
        or (r = 'registrar' and l.status = 'open' and public.signup_access(l.id))), '[]'::jsonb);
end $$;

create or replace function public.signup_get(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare r text; l public.signup_lists%rowtype;
begin
  r := public.need_role(array['admin', 'registrar', 'manager']);
  select * into l from public.signup_lists where id = p_id;
  if not found then raise exception 'Sign-up list not found.'; end if;
  if r = 'registrar' and (l.status <> 'open' or not public.signup_access(l.id)) then
    raise exception 'You can only see an open sign-up list that you have access to.';
  end if;
  if r = 'manager' and not public.signup_access(l.id) then raise exception 'You do not have access to this sign-up list.'; end if;
  return jsonb_build_object(
    'id', l.id, 'title', l.title, 'status', l.status, 'code', l.code,
    'voice_part_ids', l.voice_part_ids, 'allowed_area_ids', l.allowed_area_ids,
    'location_check', l.location_check, 'venue_lat', l.venue_lat, 'venue_lng', l.venue_lng,
    'radius_m', l.radius_m, 'opened_at', l.opened_at,
    'rotating_qr', l.rotating_qr, 'rotation_seconds', l.rotation_seconds,
    'entries', (select count(*) from public.signup_entries e where e.list_id = l.id and not e.removed));
end $$;

create or replace function public.signup_qr_payload(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r text; l public.signup_lists%rowtype; w bigint; secs int;
begin
  r := public.need_role(array['admin', 'registrar', 'manager']);
  perform public.rate_check('qr', 120, 60);
  select * into l from public.signup_lists where id = p_id;
  if not found then raise exception 'Sign-up list not found.'; end if;
  if r = 'registrar' and (l.status <> 'open' or not public.signup_access(l.id)) then
    raise exception 'You can only see an open sign-up list that you have access to.';
  end if;
  if r = 'manager' and not public.signup_access(l.id) then raise exception 'You do not have access to this sign-up list.'; end if;
  if not l.rotating_qr then raise exception 'This sign-up list uses a fixed QR code, not a rotating one.'; end if;
  if l.status <> 'open' then raise exception 'Sign-ups are closed. Open them to show the QR code.'; end if;
  w := floor(extract(epoch from now()) / l.rotation_seconds)::bigint;
  secs := l.rotation_seconds - (extract(epoch from now())::bigint % l.rotation_seconds)::int;
  return jsonb_build_object(
    'code', l.code || '.' || w::text || '.' || public.rot_code(l.rotation_secret, w),
    'seconds_left', secs, 'rotation_seconds', l.rotation_seconds, 'title', l.title,
    'entries', (select count(*) from public.signup_entries e where e.list_id = l.id and not e.removed));
end $$;

create or replace function public.signup_save(
  p_id uuid, p_title text, p_voices uuid[], p_areas uuid[],
  p_location boolean, p_lat double precision, p_lng double precision, p_radius int,
  p_rotating boolean default false, p_rotation int default 30
) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare r text; lid uuid; vs uuid[] := coalesce(p_voices, '{}'); ar uuid[] := coalesce(p_areas, '{}');
begin
  r := public.need_role(array['admin', 'manager']);
  if char_length(btrim(coalesce(p_title, ''))) < 2 then raise exception 'Please enter a title.'; end if;
  if (select count(*) from public.voice_parts where id = any (vs)) <> cardinality(vs) then
    raise exception 'One of the chosen voice parts does not exist.';
  end if;
  if (select count(*) from public.areas where id = any (ar)) <> cardinality(ar) then
    raise exception 'One of the chosen areas does not exist.';
  end if;
  if p_location and (p_lat is null or p_lng is null) then
    raise exception 'Set the venue location, or turn the location check off.';
  end if;
  if coalesce(p_rotation, 30) not between 10 and 600 then
    raise exception 'The code can change every 10 to 600 seconds.';
  end if;
  if p_id is null then
    insert into public.signup_lists (title, voice_part_ids, allowed_area_ids, location_check,
                                     venue_lat, venue_lng, radius_m, rotating_qr, rotation_seconds, created_by)
    values (btrim(p_title), vs, ar, p_location, p_lat, p_lng, coalesce(p_radius, 200),
            coalesce(p_rotating, false), coalesce(p_rotation, 30), auth.uid())
    returning id into lid;
    perform public.log_action('signup.create', 'signup', lid::text, jsonb_build_object('title', btrim(p_title)));
    -- A manager who creates a sign-up list can work with it from then on
    if r = 'manager' then
      insert into public.reviewer_grants (account_id, signup_list_id, created_by) values (auth.uid(), lid, auth.uid()) on conflict do nothing;
    end if;
  else
    if r = 'manager' and not public.signup_access(p_id) then raise exception 'You do not have access to this sign-up list.'; end if;
    update public.signup_lists
       set title = btrim(p_title), voice_part_ids = vs, allowed_area_ids = ar,
           location_check = p_location, venue_lat = p_lat, venue_lng = p_lng,
           radius_m = coalesce(p_radius, 200),
           rotating_qr = coalesce(p_rotating, false), rotation_seconds = coalesce(p_rotation, 30)
     where id = p_id
     returning id into lid;
    if lid is null then raise exception 'Sign-up list not found.'; end if;
  end if;
  return lid;
end $$;

create or replace function public.signup_set_open(p_id uuid, p_open boolean) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r text; l public.signup_lists%rowtype; o public.signup_lists%rowtype;
begin
  r := public.need_role(array['admin', 'manager']);
  if r = 'manager' and not public.signup_access(p_id) then raise exception 'You do not have access to this sign-up list.'; end if;
  select * into l from public.signup_lists where id = p_id for update;
  if not found then raise exception 'Sign-up list not found.'; end if;
  if p_open then
    if l.status = 'open' then return; end if;
    update public.signup_lists set status = 'open', opened_at = now(), closed_at = null where id = p_id;
    perform public.log_action('signup.open', 'signup', p_id::text, jsonb_build_object('title', l.title));
  else
    if l.status <> 'open' then return; end if;
    update public.signup_lists set status = 'closed', closed_at = now() where id = p_id;
    perform public.log_action('signup.close', 'signup', p_id::text, jsonb_build_object('title', l.title));
  end if;
end $$;

create or replace function public.signup_new_link(p_id uuid) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare r text; l public.signup_lists%rowtype; c text;
begin
  r := public.need_role(array['admin', 'manager']);
  if r = 'manager' and not public.signup_access(p_id) then raise exception 'You do not have access to this sign-up list.'; end if;
  select * into l from public.signup_lists where id = p_id for update;
  if not found then raise exception 'Sign-up list not found.'; end if;
  c := encode(extensions.gen_random_bytes(12), 'hex');
  update public.signup_lists set code = c where id = p_id;
  perform public.log_action('signup.newlink', 'signup', p_id::text, jsonb_build_object('title', l.title));
  return c;
end $$;

create or replace function public.signup_delete(p_id uuid, p_confirm text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r text; l public.signup_lists%rowtype; n int;
begin
  r := public.need_role(array['admin', 'manager']);
  if r = 'manager' and not public.signup_access(p_id) then raise exception 'You do not have access to this sign-up list.'; end if;
  select * into l from public.signup_lists where id = p_id for update;
  if not found then raise exception 'Sign-up list not found.'; end if;
  if l.status = 'open' then raise exception 'Close sign-ups before deleting this list.'; end if;
  if btrim(coalesce(p_confirm, '')) <> l.title then
    raise exception 'The typed title does not match. Nothing was deleted.';
  end if;
  select count(*) into n from public.signup_entries where list_id = p_id;
  delete from public.signup_lists where id = p_id;
  perform public.log_action('signup.delete', 'signup', p_id::text,
    jsonb_build_object('title', l.title, 'entries', n));
end $$;

create or replace function public.signup_entries(p_list uuid, p_include_removed boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare r text; l public.signup_lists%rowtype; res jsonb;
begin
  r := public.need_role(array['admin', 'registrar', 'manager']);
  select * into l from public.signup_lists where id = p_list;
  if not found then raise exception 'Sign-up list not found.'; end if;
  if r = 'registrar' and (l.status <> 'open' or not public.signup_access(l.id)) then
    raise exception 'You can only see an open sign-up list that you have access to.';
  end if;
  if r = 'manager' and not public.signup_access(l.id) then raise exception 'You do not have access to this sign-up list.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id,
      'display_name', public.display_name(t.name, e.title_specify, e.full_name),
      'title_id', e.title_id, 'title_specify', e.title_specify, 'full_name', e.full_name,
      'area_id', e.area_id, 'area', a.name,
      'district', g.name,
      'voice_part_id', e.voice_part_id, 'voice_part', v.name,
      'contact', case when r in ('admin', 'manager') then e.contact else null end,
      'source', e.source, 'added_by_name', e.added_by_name, 'forced', e.forced,
      'created_at', e.created_at,
      'removed', e.removed, 'removed_reason', e.removed_reason,
      'person_id', e.person_id,
      'person_name', (select public.display_name(pt.name, p.title_specify, p.full_name)
                        from public.people p left join public.titles pt on pt.id = p.title_id
                       where p.id = e.person_id and r in ('admin', 'manager')),
      'can_edit', (r in ('admin', 'manager') or coalesce(e.added_by = auth.uid(), false))) order by e.created_at desc), '[]'::jsonb)
    into res
    from public.signup_entries e
    left join public.titles t on t.id = e.title_id
    left join public.areas a on a.id = e.area_id
    left join public.district_groups g on g.id = e.district_group_id
    left join public.voice_parts v on v.id = e.voice_part_id
   where e.list_id = p_list and (p_include_removed or not e.removed);
  return res;
end $$;

create or replace function public.signup_paste(p_list uuid, p_rows jsonb, p_commit boolean default false) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  r text; l public.signup_lists%rowtype; rw jsonb; i int := 0; v jsonb; chk jsonb; st text; msg text;
  results jsonb := '[]'::jsonb; seen jsonb := '[]'::jsonb; b jsonb; bst text; bmatch text;
  n_new int := 0; n_added int := 0; n_similar int := 0; n_already int := 0; n_invalid int := 0;
  forced boolean;
begin
  r := public.need_role(array['admin', 'registrar', 'manager']);
  perform public.rate_check('signup_paste', 20, 60);
  select * into l from public.signup_lists where id = p_list;
  if not found then raise exception 'Sign-up list not found.'; end if;
  if r = 'registrar' and (l.status <> 'open' or not public.signup_access(l.id)) then
    raise exception 'You can only add to an open sign-up list that you have access to.';
  end if;
  if r = 'manager' and not public.signup_access(l.id) then raise exception 'You do not have access to this sign-up list.'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'There is nothing to add.';
  end if;
  if jsonb_array_length(p_rows) > 300 then raise exception 'Please add at most 300 people at a time.'; end if;

  for rw in select * from jsonb_array_elements(p_rows) loop
    i := i + 1; st := null; msg := null; chk := null;
    begin
      v := public._signup_row(l, rw);
      chk := public._signup_check(l.id, v->>'name', nullif(v->>'dg', '')::uuid, null);
      st := chk->>'status';
      -- also compare with the rows earlier in this same paste
      if st = 'new' then
        for b in select * from jsonb_array_elements(seen) loop
          if b->>'key' = public.name_key(v->>'name') then
            if coalesce(b->>'dg', '') = coalesce(v->>'dg', '') or b->>'dg' is null or v->>'dg' is null then
              st := 'already'; msg := 'Same name as line ' || (b->>'line') || ' in this paste.';
            elsif st <> 'already' then st := 'similar'; msg := 'Same name as line ' || (b->>'line') || ' in this paste.'; end if;
          elsif similarity(b->>'key', public.name_key(v->>'name')) >= 0.5 and st = 'new' then
            st := 'similar'; msg := 'Looks like line ' || (b->>'line') || ' in this paste.';
          end if;
        end loop;
      end if;
      if msg is null and st <> 'new' then
        msg := 'Looks like ' || (chk->'matches'->0->>'name') || ' (already on this list).';
      end if;
      seen := seen || jsonb_build_array(jsonb_build_object(
                'key', public.name_key(v->>'name'), 'dg', v->>'dg', 'line', i));
      forced := coalesce((rw->>'force')::boolean, false);
      if st = 'new' then
        n_new := n_new + 1;
        if p_commit then
          perform public._signup_insert(l.id, nullif(v->>'title_id', '')::uuid, v->>'spec', v->>'name',
                    nullif(v->>'area_id', '')::uuid, nullif(v->>'dg', '')::uuid,
                    nullif(v->>'voice_id', '')::uuid, v->>'contact', 'paste', false);
          n_added := n_added + 1; st := 'added';
        end if;
      else
        if st = 'already' then n_already := n_already + 1; else n_similar := n_similar + 1; end if;
        if p_commit and forced then
          perform public._signup_insert(l.id, nullif(v->>'title_id', '')::uuid, v->>'spec', v->>'name',
                    nullif(v->>'area_id', '')::uuid, nullif(v->>'dg', '')::uuid,
                    nullif(v->>'voice_id', '')::uuid, v->>'contact', 'paste', true);
          n_added := n_added + 1; st := 'added';
        elsif p_commit then
          st := 'skipped';
        end if;
      end if;
    exception when others then
      st := 'invalid'; msg := SQLERRM; n_invalid := n_invalid + 1;
    end;
    results := results || jsonb_build_array(jsonb_build_object('idx', i, 'status', st, 'message', msg));
  end loop;

  if p_commit and n_added > 0 then
    perform public.log_action('signup.paste', 'signup', l.id::text,
      jsonb_build_object('title', l.title, 'added', n_added, 'rows', i));
  end if;
  return jsonb_build_object('rows', results, 'new', n_new, 'added', n_added,
                            'similar', n_similar, 'already', n_already, 'invalid', n_invalid);
end $$;

create or replace function public.signup_update_entry(
  p_id uuid, p_title_id uuid, p_title_specify text, p_full_name text, p_area_id uuid,
  p_voice_part_id uuid, p_district text, p_contact text, p_force boolean default false
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  r text; e public.signup_entries%rowtype; l public.signup_lists%rowtype; v jsonb; chk jsonb;
begin
  r := public.need_role(array['admin', 'registrar', 'manager']);
  select * into e from public.signup_entries where id = p_id;
  if not found then raise exception 'Entry not found.'; end if;
  select * into l from public.signup_lists where id = e.list_id;
  if r = 'registrar' and (e.added_by is distinct from auth.uid() or l.status <> 'open' or not public.signup_access(l.id)) then
    raise exception 'You can only edit entries you added.';
  end if;
  if r = 'manager' and not public.signup_access(l.id) then raise exception 'You do not have access to this sign-up list.'; end if;
  if e.removed then raise exception 'This entry was removed.'; end if;
  v := public._signup_row(l, jsonb_build_object(
         'title_id', p_title_id, 'title_specify', p_title_specify, 'name', p_full_name,
         'area_id', p_area_id, 'voice_part_id', p_voice_part_id, 'district', p_district,
         'contact', p_contact));
  chk := public._signup_check(l.id, v->>'name', nullif(v->>'dg', '')::uuid, e.id);
  if chk->>'status' <> 'new' and not coalesce(p_force, false) then
    return jsonb_build_object('status', chk->>'status', 'matches', chk->'matches');
  end if;
  update public.signup_entries
     set title_id = nullif(v->>'title_id', '')::uuid, title_specify = v->>'spec', full_name = v->>'name',
         name_key = public.name_key(v->>'name'), area_id = nullif(v->>'area_id', '')::uuid,
         district_group_id = nullif(v->>'dg', '')::uuid, voice_part_id = nullif(v->>'voice_id', '')::uuid,
         contact = v->>'contact', forced = (chk->>'status' <> 'new')
   where id = e.id;
  return jsonb_build_object('status', 'saved');
end $$;

create or replace function public.signup_remove_entry(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r text; e public.signup_entries%rowtype; l public.signup_lists%rowtype;
begin
  r := public.need_role(array['admin', 'registrar', 'manager']);
  perform public.rate_check('signup_remove', 60, 60);
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'Please give a reason for removing this entry.';
  end if;
  select * into e from public.signup_entries where id = p_id;
  if not found then raise exception 'Entry not found.'; end if;
  select * into l from public.signup_lists where id = e.list_id;
  if r = 'registrar' and (e.added_by is distinct from auth.uid() or l.status <> 'open' or not public.signup_access(l.id)) then
    raise exception 'You can only remove entries you added.';
  end if;
  if r = 'manager' and not public.signup_access(l.id) then raise exception 'You do not have access to this sign-up list.'; end if;
  if e.removed then return; end if;
  update public.signup_entries
     set removed = true, removed_by = auth.uid(), removed_at = now(), removed_reason = btrim(p_reason)
   where id = e.id;
  perform public.log_action('signup.remove_entry', 'signup', l.id::text,
    jsonb_build_object('title', l.title, 'person', e.full_name, 'reason', btrim(p_reason)));
end $$;

create or replace function public.signup_restore_entry(p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r text; e public.signup_entries%rowtype; l public.signup_lists%rowtype;
begin
  r := public.need_role(array['admin', 'manager']);
  select * into e from public.signup_entries where id = p_id;
  if not found then raise exception 'Entry not found.'; end if;
  if not e.removed then return; end if;
  select * into l from public.signup_lists where id = e.list_id;
  if r = 'manager' and not public.signup_access(l.id) then raise exception 'You do not have access to this sign-up list.'; end if;
  update public.signup_entries
     set removed = false, removed_by = null, removed_at = null, removed_reason = null
   where id = e.id;
  perform public.log_action('signup.restore_entry', 'signup', l.id::text,
    jsonb_build_object('title', l.title, 'person', e.full_name));
end $$;

create or replace function public.grant_access(p_account uuid, p_event uuid, p_list uuid, p_signup uuid default null) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare a public.accounts%rowtype;
begin
  perform public.need_role(array['admin']);
  select * into a from public.accounts where id = p_account;
  if not found or a.role not in ('registrar', 'reviewer', 'manager') then raise exception 'Choose a registrar, reviewer or event manager account.'; end if;
  if (p_event is not null)::int + (p_list is not null)::int + (p_signup is not null)::int <> 1 then
    raise exception 'Choose one event, list or sign-up list.';
  end if;
  if p_signup is not null and a.role not in ('registrar', 'manager') then raise exception 'Only registrars and event managers work with sign-up lists.'; end if;
  if p_list is not null and a.role = 'manager' then raise exception 'Give an event manager a whole event or a sign-up list.'; end if;
  insert into public.reviewer_grants (account_id, event_id, list_id, signup_list_id, created_by)
  values (p_account, p_event, p_list, p_signup, auth.uid())
  on conflict do nothing;
  perform public.log_action('grant.add', 'account', p_account::text,
    jsonb_build_object('email', a.email, 'event_id', p_event, 'list_id', p_list, 'signup_list_id', p_signup));
end $$;

create or replace function public.set_account_scope(p_id uuid, p_scope text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare a public.accounts%rowtype;
begin
  perform public.need_role(array['admin']);
  if p_scope not in ('all', 'selected') then raise exception 'Unknown access type.'; end if;
  select * into a from public.accounts where id = p_id;
  if found and a.role = 'manager' then raise exception 'An event manager always works only with what you select.'; end if;
  if not found or a.role not in ('registrar', 'reviewer') then raise exception 'Only registrars and reviewers have this setting.'; end if;
  update public.accounts set access_scope = p_scope where id = p_id;
  perform public.log_action('account.scope', 'account', p_id::text,
    jsonb_build_object('email', a.email, 'role', a.role, 'scope', p_scope));
end $$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text := coalesce(new.raw_app_meta_data->>'role', 'member');
begin
  -- Visitors of the public sign-up page are anonymous sessions: they never get an account.
  if coalesce(new.is_anonymous, false) then return new; end if;
  if r not in ('admin', 'manager', 'reviewer', 'registrar', 'member') then r := 'member'; end if;
  insert into public.accounts (id, email, full_name, role, access_scope)
  values (new.id, new.email, nullif(btrim(coalesce(new.raw_user_meta_data->>'full_name', '')), ''), r,
          case when r in ('reviewer', 'manager') then 'selected' else 'all' end)
  on conflict (id) do nothing;
  return new;
end $$;

create or replace function public.get_open_lists() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r text := public.app_role();
begin
  if r is null then return '[]'::jsonb; end if;
  -- Members see every open list (they scan its QR code). Staff see the open lists they have access to.
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', l.id, 'title', l.title, 'event_name', e.name,
        'location_check', l.location_check, 'rotating_qr', l.rotating_qr,
        'radius_m', l.radius_m, 'allowed_area_ids', l.allowed_area_ids,
        'present_count', case when r in ('admin', 'registrar', 'manager')
                              then (select count(*)::int from public.attendance at where at.list_id = l.id and not at.removed) end,
        'opened_at', l.opened_at) order by l.opened_at desc)
      from public.lists l join public.events e on e.id = l.event_id
     where l.status = 'open' and (r = 'member' or public.list_access(l.id))), '[]'::jsonb);
end $$;

-- 3. Event managers also see removed attendance on their lists, so they can restore it
drop policy if exists attendance_select on public.attendance;
create policy attendance_select on public.attendance for select to authenticated
  using (
    public.app_role() = 'admin'
    or (public.app_role() = 'manager' and public.can_review_list(list_id))
    or (not removed and public.can_review_list(list_id))
    or (not removed and person_id = public.my_person_id())
  );

-- 4. Who may call the new functions
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any (array['event_team', 'signup_team'])
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
