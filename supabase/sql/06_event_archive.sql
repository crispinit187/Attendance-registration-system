-- RUN THIS ONCE in the Supabase SQL Editor (after 05_event_and_entry_delete.sql).
-- Adds "archive an event", and changes "delete an event" so that it works on an
-- ARCHIVED event and deletes everything inside it (lists and attendance records).
-- Fresh installs already get all of this from 01, 02 and 03.

alter table public.events add column if not exists archived_at timestamptz;

create or replace function public.open_list(p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare l public.lists%rowtype; o public.lists%rowtype;
begin
  perform public.need_role(array['admin']);
  select * into l from public.lists where id = p_id for update;
  if not found then raise exception 'List not found.'; end if;
  if l.status = 'open' then return; end if;
  if l.status = 'archived' then raise exception 'Restore this list from the archive before opening it.'; end if;
  if exists (select 1 from public.events where id = l.event_id and archived_at is not null) then
    raise exception 'This list belongs to an archived event. Restore the event first.';
  end if;
  select * into o from public.lists where status = 'open';
  if found then
    raise exception 'The list "%" is already open. Close it before opening another list.', o.title;
  end if;
  begin
    update public.lists set status = 'open', opened_at = now(), closed_at = null where id = p_id;
  exception when unique_violation then
    raise exception 'Another list was just opened. Close it before opening this one.';
  end;
  perform public.log_action('list.open', 'list', p_id::text, jsonb_build_object('title', l.title));
end $$;

create or replace function public.save_list(
  p_id uuid, p_event uuid, p_title text, p_allowed uuid[],
  p_location boolean, p_lat double precision, p_lng double precision, p_radius int,
  p_rotating boolean, p_rotation int
) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare lid uuid; cur public.lists%rowtype; allowed uuid[] := coalesce(p_allowed, '{}');
begin
  perform public.need_role(array['admin']);
  if char_length(btrim(coalesce(p_title, ''))) < 2 then raise exception 'Please enter a list title.'; end if;
  if (select count(*) from public.areas where id = any (allowed)) <> cardinality(allowed) then
    raise exception 'One of the chosen areas does not exist.';
  end if;
  if p_location and (p_lat is null or p_lng is null) then
    raise exception 'Set the venue location, or turn the location check off.';
  end if;
  if p_id is null then
    if not exists (select 1 from public.events where id = p_event) then raise exception 'Event not found.'; end if;
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

create or replace function public.archive_event(p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare ev public.events%rowtype;
begin
  perform public.need_role(array['admin']);
  select * into ev from public.events where id = p_id for update;
  if not found then raise exception 'Event not found.'; end if;
  if ev.archived_at is not null then return; end if;
  if exists (select 1 from public.lists where event_id = p_id and status = 'open') then
    raise exception 'A list in this event is open. Close it before archiving the event.';
  end if;
  update public.events set archived_at = now() where id = p_id;
  perform public.log_action('event.archive', 'event', p_id::text, jsonb_build_object('name', ev.name));
end $$;

create or replace function public.unarchive_event(p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare ev public.events%rowtype;
begin
  perform public.need_role(array['admin']);
  select * into ev from public.events where id = p_id for update;
  if not found then raise exception 'Event not found.'; end if;
  if ev.archived_at is null then return; end if;
  update public.events set archived_at = null where id = p_id;
  perform public.log_action('event.unarchive', 'event', p_id::text, jsonb_build_object('name', ev.name));
end $$;

create or replace function public.delete_event(p_id uuid, p_confirm text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare ev public.events%rowtype; nl int; na int;
begin
  perform public.need_role(array['admin']);
  select * into ev from public.events where id = p_id for update;
  if not found then raise exception 'Event not found.'; end if;
  if ev.archived_at is null then raise exception 'Archive this event before deleting it.'; end if;
  if exists (select 1 from public.lists where event_id = p_id and status = 'open') then
    raise exception 'A list in this event is open. Close it first.';
  end if;
  if btrim(coalesce(p_confirm, '')) <> ev.name then
    raise exception 'The typed name does not match. Nothing was deleted.';
  end if;
  select count(*) into nl from public.lists where event_id = p_id;
  select count(*) into na from public.attendance a join public.lists l on l.id = a.list_id where l.event_id = p_id;
  delete from public.events where id = p_id;      -- lists, attendance and grants go with it
  perform public.log_action('event.delete', 'event', p_id::text,
    jsonb_build_object('name', ev.name, 'lists', nl, 'attendance_records', na));
end $$;

grant execute on function public.archive_event(uuid)   to authenticated, service_role;
grant execute on function public.unarchive_event(uuid) to authenticated, service_role;
grant execute on function public.delete_event(uuid, text) to authenticated, service_role;
