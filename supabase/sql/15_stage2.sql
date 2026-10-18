-- ============================================================================
-- Stage 2: offline sync, late marks, recent actions with undo, history
-- Run AFTER 14_trackers.sql. Safe to run again.
-- ============================================================================

create table if not exists public.action_journal (
  id        uuid primary key default gen_random_uuid(),
  actor     uuid not null,
  at        timestamptz not null default now(),
  kind      text not null,
  label     text not null,
  ref       jsonb not null default '{}'::jsonb,
  undone_at timestamptz
);
create index if not exists action_journal_actor on public.action_journal (actor, at desc);

create table if not exists public.sync_ops (
  client_id uuid primary key,
  actor     uuid not null,
  at        timestamptz not null default now()
);

create table if not exists public.late_marks (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid unique,
  list_id           uuid not null references public.lists(id) on delete cascade,
  person_id         uuid not null references public.people(id) on delete cascade,
  at                timestamptz not null,
  submitted_by      uuid references auth.users(id) on delete set null,
  submitted_by_name text,
  submitted_at      timestamptz not null default now(),
  status            text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by        uuid references auth.users(id) on delete set null,
  decided_at        timestamptz
);
create index if not exists late_marks_status on public.late_marks (status);
create unique index if not exists late_marks_pending_key on public.late_marks (list_id, person_id) where status = 'pending';

alter table public.action_journal enable row level security;
alter table public.sync_ops enable row level security;
alter table public.late_marks enable row level security;
drop policy if exists action_journal_select on public.action_journal;
create policy action_journal_select on public.action_journal for select to authenticated using (actor = auth.uid());
drop policy if exists late_marks_select on public.late_marks;
create policy late_marks_select on public.late_marks for select to authenticated using (public.app_role() = 'admin');
grant select on public.action_journal, public.late_marks to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'late_marks') then
    alter publication supabase_realtime add table public.late_marks;
  end if;
end $$;

-- Journal of what each person did, so they can see and undo their own recent actions
create or replace function public._journal(p_kind text, p_label text, p_ref jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  if random() < 0.02 then delete from public.action_journal where at < now() - interval '7 days'; end if;
  insert into public.action_journal (actor, kind, label, ref) values (auth.uid(), p_kind, left(p_label, 200), coalesce(p_ref, '{}'::jsonb));
end $$;

create or replace function public.tracker_set_mark(p_entry uuid, p_date uuid, p_on boolean, p_at timestamptz default null) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare e public.tracker_entries%rowtype; d public.tracker_dates%rowtype; who text; pn text; lt text; n int;
begin
  select * into e from public.tracker_entries where id = p_entry;
  if not found then raise exception 'Person not found on this list.'; end if;
  perform public._tracker_guard(e.list_id, 'mark');
  select * into d from public.tracker_dates where id = p_date;
  if not found or d.list_id <> e.list_id then raise exception 'That date is not on this list.'; end if;
  if d.removed_at is not null then raise exception 'That date was removed.'; end if;
  if e.removed then raise exception 'This person was removed from the list.'; end if;
  perform public.rate_check('tracker_mark', 400, 60);
  if p_on then
    select coalesce(nullif(full_name, ''), email) into who from public.accounts where id = auth.uid();
    insert into public.tracker_marks (entry_id, date_id, list_id, marked_by, marked_by_name, marked_at)
    values (e.id, d.id, e.list_id, auth.uid(), who, case when p_at is null or p_at > now() then now() else p_at end)
    on conflict do nothing;
    get diagnostics n = row_count;
  else
    delete from public.tracker_marks where entry_id = e.id and date_id = d.id;
    get diagnostics n = row_count;
  end if;
  if n > 0 then
    select p.full_name, l.title into pn, lt from public.tracker_entries te join public.people p on p.id = te.person_id join public.tracker_lists l on l.id = te.list_id where te.id = e.id;
    perform public._journal('tracker.mark', case when p_on then 'Ticked ' else 'Unticked ' end || pn || ' on ' || to_char(d.on_date, 'DD Mon') || ' (' || lt || ')',
      jsonb_build_object('entry', e.id, 'date', d.id, 'on', p_on, 'list', e.list_id));
  end if;
end $$;

create or replace function public.tracker_add_entry(p_list uuid, p_person uuid, p_dates uuid[] default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare l public.tracker_lists%rowtype; e public.tracker_entries%rowtype; pr public.people%rowtype; eid uuid; status text;
begin
  l := public._tracker_guard(p_list, 'mark');
  perform public.rate_check('tracker_add', 120, 60);
  select * into pr from public.people where id = p_person and not archived and merged_into is null;
  if not found then raise exception 'Person not found.'; end if;
  select * into e from public.tracker_entries where list_id = p_list and person_id = p_person;
  if found then
    if e.removed then
      if public.app_role() not in ('admin', 'manager', 'list_manager') then
        raise exception 'This person was removed from the list. Ask a manager to restore them.';
      end if;
      update public.tracker_entries set removed = false, removed_by = null, removed_at = null where id = e.id;
      status := 'restored';
    else
      status := 'already';
    end if;
    eid := e.id;
  else
    insert into public.tracker_entries (list_id, person_id, added_by) values (p_list, p_person, auth.uid()) returning id into eid;
    status := 'added';
    perform public.log_action('tracker.entry.add', 'tracker_list', p_list::text,
      jsonb_build_object('list_title', l.title, 'person', pr.full_name));
  end if;
  perform public._tracker_tick_many(eid, p_list, p_dates);
  if status in ('added', 'restored') then
    perform public._journal('tracker.entry', 'Added ' || pr.full_name || ' to ' || l.title, jsonb_build_object('entry', eid, 'list', p_list, 'was', status));
  end if;
  return jsonb_build_object('status', status, 'entry_id', eid);
end $$;

create or replace function public.tracker_create_person(
  p_list uuid, p_name text, p_title_id uuid, p_title_specify text, p_area_id uuid, p_voice_part_id uuid,
  p_district text, p_congregation text, p_contact text, p_dates uuid[] default '{}', p_force boolean default false
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare l public.tracker_lists%rowtype; nm text; c text; pid uuid; eid uuid; dg uuid; cg uuid; aid uuid; sim jsonb; spec text;
begin
  l := public._tracker_guard(p_list, 'mark');
  perform public.rate_check('tracker_create_person', 40, 60);
  nm := public._cap_words(p_name);
  if char_length(nm) < 2 then raise exception 'Please enter the full name.'; end if;
  if not p_force then
    select coalesce(jsonb_agg(public._tracker_card(x.id, p_list) order by x.score desc), '[]'::jsonb) into sim
      from (select p.id, similarity(p.full_name, nm) as score from public.people p
             where not p.archived and p.merged_into is null and similarity(p.full_name, nm) >= 0.5
             order by similarity(p.full_name, nm) desc limit 5) x;
    if jsonb_array_length(sim) > 0 then return jsonb_build_object('status', 'similar', 'matches', sim); end if;
  end if;
  spec := case when p_title_id is null then null else nullif(left(btrim(coalesce(p_title_specify, '')), 60), '') end;
  if p_title_id is not null and not exists (select 1 from public.titles where id = p_title_id and active) then
    raise exception 'Unknown title.';
  end if;
  if p_voice_part_id is not null and not exists (select 1 from public.voice_parts where id = p_voice_part_id and active) then
    raise exception 'Unknown voice part.';
  end if;
  aid := coalesce(p_area_id, public.resolve_area(l.title));
  dg := case when char_length(public.normalize_district(p_district)) >= 2 then public.resolve_district(p_district) end;
  cg := public.resolve_congregation(p_congregation);
  c := public.normalize_contact(p_contact);
  insert into public.people (title_id, title_specify, full_name, area_id, district_group_id, congregation_group_id,
                             voice_part_id, contact, created_by)
  values (p_title_id, spec, nm, aid, dg, cg, p_voice_part_id, c, auth.uid()) returning id into pid;
  insert into public.tracker_entries (list_id, person_id, added_by) values (p_list, pid, auth.uid()) returning id into eid;
  perform public._tracker_tick_many(eid, p_list, p_dates);
  perform public.log_action('tracker.person.create', 'tracker_list', p_list::text,
    jsonb_build_object('list_title', l.title, 'person', nm));
  perform public._journal('tracker.entry', 'Registered ' || nm || ' on ' || l.title, jsonb_build_object('entry', eid, 'list', p_list, 'was', 'created'));
  return jsonb_build_object('status', 'created', 'entry_id', eid, 'person_id', pid);
end $$;


-- Attendance marking by a registrar now also lands in the journal
create or replace function public.mark_attendance_manual(p_list uuid, p_person uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r text; l public.lists%rowtype; pr public.people%rowtype; method text; res jsonb;
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
  res := public._put_attendance(l.id, pr.id, method, true);
  if res->>'status' = 'marked' then
    perform public._journal('attendance.mark', 'Marked ' || pr.full_name || ' present on ' || l.title,
      jsonb_build_object('att', res->'attendance_id', 'list', l.id));
  end if;
  return res;
end $$;

-- ---------------------------------------------------------------------------------
-- My recent actions and undo
-- ---------------------------------------------------------------------------------
create or replace function public.my_recent_actions(p_limit int default 40) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.need_role(array['admin', 'manager', 'list_manager', 'registrar']);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', j.id, 'at', j.at, 'kind', j.kind, 'label', j.label,
             'undone', j.undone_at is not null, 'can_undo', j.undone_at is null and j.at > now() - interval '24 hours')
           order by j.at desc)
      from (select * from public.action_journal where actor = auth.uid() and at > now() - interval '3 days'
             order by at desc limit greatest(1, least(coalesce(p_limit, 40), 100))) j), '[]'::jsonb);
end $$;

create or replace function public.undo_action(p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare j public.action_journal%rowtype; e public.tracker_entries%rowtype; a public.attendance%rowtype; who text;
begin
  perform public.need_role(array['admin', 'manager', 'list_manager', 'registrar']);
  select * into j from public.action_journal where id = p_id and actor = auth.uid() for update;
  if not found then raise exception 'Action not found.'; end if;
  if j.undone_at is not null then raise exception 'That was already undone.'; end if;
  if j.at < now() - interval '24 hours' then raise exception 'It is too late to undo that. Ask a manager to change it.'; end if;
  select coalesce(nullif(full_name, ''), email) into who from public.accounts where id = auth.uid();

  if j.kind = 'tracker.mark' then
    select * into e from public.tracker_entries where id = (j.ref->>'entry')::uuid;
    if not found then raise exception 'The person is no longer on that list.'; end if;
    perform public._tracker_guard(e.list_id, 'mark');
    if (j.ref->>'on')::boolean then
      delete from public.tracker_marks where entry_id = e.id and date_id = (j.ref->>'date')::uuid;
    else
      insert into public.tracker_marks (entry_id, date_id, list_id, marked_by, marked_by_name)
      values (e.id, (j.ref->>'date')::uuid, e.list_id, auth.uid(), who) on conflict do nothing;
    end if;
  elsif j.kind = 'tracker.entry' then
    select * into e from public.tracker_entries where id = (j.ref->>'entry')::uuid;
    if not found then raise exception 'The person is no longer on that list.'; end if;
    perform public._tracker_guard(e.list_id, 'mark');
    update public.tracker_entries set removed = true, removed_by = auth.uid(), removed_at = now() where id = e.id;
  elsif j.kind = 'attendance.mark' then
    select * into a from public.attendance where id = (j.ref->>'att')::uuid;
    if not found then raise exception 'That record no longer exists.'; end if;
    if public.app_role() <> 'admin' and not public.list_access(a.list_id) then raise exception 'You do not have access to this list.'; end if;
    if a.removed then raise exception 'That attendee was already removed.'; end if;
    update public.attendance set removed = true, removed_by = auth.uid(), removed_at = now(), removed_reason = 'Undone by ' || coalesce(who, 'the person who marked it') where id = a.id;
  else
    raise exception 'That cannot be undone.';
  end if;
  update public.action_journal set undone_at = now() where id = j.id;
  perform public.log_action('action.undo', 'journal', j.id::text, jsonb_build_object('what', j.label));
end $$;

-- ---------------------------------------------------------------------------------
-- Offline sync
-- ---------------------------------------------------------------------------------
-- Ticks recorded without a connection. Each op: {entry, date, on, at}. Ticking is idempotent, so replays are harmless.
create or replace function public.tracker_sync_marks(p_ops jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare o jsonb; i int := 0; res jsonb := '[]'::jsonb;
begin
  perform public.need_role(array['admin', 'manager', 'list_manager', 'registrar']);
  if jsonb_typeof(p_ops) <> 'array' then raise exception 'Nothing to sync.'; end if;
  if jsonb_array_length(p_ops) > 300 then raise exception 'Too many changes at once. Sync again in a moment.'; end if;
  for o in select * from jsonb_array_elements(p_ops) loop
    i := i + 1;
    begin
      perform public.tracker_set_mark((o->>'entry')::uuid, (o->>'date')::uuid, coalesce((o->>'on')::boolean, true), nullif(o->>'at', '')::timestamptz);
      res := res || jsonb_build_object('i', i, 'status', 'ok');
    exception when others then
      res := res || jsonb_build_object('i', i, 'status', 'error', 'message', sqlerrm);
    end;
  end loop;
  return res;
end $$;

-- Attendance marks made by a registrar without a connection. Each op: {client_id, list, person, at}.
-- A mark made while the list was open counts. One made outside the open window waits for an admin.
create or replace function public.attendance_sync(p_ops jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r text; o jsonb; i int := 0; res jsonb := '[]'::jsonb; l public.lists%rowtype; pr public.people%rowtype;
        cid uuid; at_ts timestamptz; out jsonb; who text; win_end timestamptz;
begin
  r := public.need_role(array['admin', 'registrar']);
  if jsonb_typeof(p_ops) <> 'array' then raise exception 'Nothing to sync.'; end if;
  if jsonb_array_length(p_ops) > 300 then raise exception 'Too many changes at once. Sync again in a moment.'; end if;
  select coalesce(nullif(full_name, ''), email) into who from public.accounts where id = auth.uid();
  for o in select * from jsonb_array_elements(p_ops) loop
    i := i + 1;
    begin
      cid := (o->>'client_id')::uuid;
      if exists (select 1 from public.sync_ops where client_id = cid) then
        res := res || jsonb_build_object('i', i, 'status', 'duplicate'); continue;
      end if;
      select * into l from public.lists where id = (o->>'list')::uuid;
      if not found then raise exception 'List not found.'; end if;
      if r = 'registrar' and not public.list_access(l.id) then raise exception 'You do not have access to this list.'; end if;
      if l.status = 'archived' then raise exception 'This list is archived.'; end if;
      select * into pr from public.people where id = (o->>'person')::uuid and not archived;
      if not found then raise exception 'Person not found.'; end if;
      if r = 'registrar' and cardinality(l.allowed_area_ids) > 0 and not (pr.area_id = any (l.allowed_area_ids)) then
        raise exception 'This list is not open to that person''s area.';
      end if;
      at_ts := least(coalesce(nullif(o->>'at', '')::timestamptz, now()), now());
      win_end := case when l.status = 'open' then now() else l.closed_at end;
      if l.opened_at is not null and at_ts >= l.opened_at - interval '2 minutes' and win_end is not null and at_ts <= win_end then
        out := public._put_attendance(l.id, pr.id, case when r = 'admin' then 'admin' else 'registrar' end, true);
        if out->>'status' = 'marked' then
          update public.attendance set marked_at = at_ts where id = (out->>'attendance_id')::uuid;
          perform public._journal('attendance.mark', 'Marked ' || pr.full_name || ' present on ' || l.title,
            jsonb_build_object('att', out->'attendance_id', 'list', l.id));
        end if;
        res := res || jsonb_build_object('i', i, 'status', out->>'status');
      else
        insert into public.late_marks (client_id, list_id, person_id, at, submitted_by, submitted_by_name)
        values (cid, l.id, pr.id, at_ts, auth.uid(), who) on conflict do nothing;
        res := res || jsonb_build_object('i', i, 'status', 'needs_approval');
      end if;
      insert into public.sync_ops (client_id, actor) values (cid, auth.uid()) on conflict do nothing;
    exception when others then
      res := res || jsonb_build_object('i', i, 'status', 'error', 'message', sqlerrm);
    end;
  end loop;
  return res;
end $$;

create or replace function public.late_marks_list(p_status text default 'pending') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.need_role(array['admin']);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', m.id, 'status', m.status, 'at', m.at, 'submitted_at', m.submitted_at,
             'submitted_by', m.submitted_by_name, 'person', p.full_name, 'person_id', p.id,
             'list_id', l.id, 'list', l.title, 'event', e.name, 'opened_at', l.opened_at, 'closed_at', l.closed_at,
             'list_status', l.status) order by m.submitted_at desc)
      from public.late_marks m
      join public.people p on p.id = m.person_id
      join public.lists l on l.id = m.list_id
      join public.events e on e.id = l.event_id
     where p_status = 'all' or m.status = p_status), '[]'::jsonb);
end $$;

create or replace function public.decide_late_mark(p_id uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare m public.late_marks%rowtype; l public.lists%rowtype; pr public.people%rowtype; out jsonb;
begin
  perform public.need_role(array['admin']);
  select * into m from public.late_marks where id = p_id for update;
  if not found then raise exception 'Not found.'; end if;
  if m.status <> 'pending' then raise exception 'That was already decided.'; end if;
  select * into l from public.lists where id = m.list_id;
  select * into pr from public.people where id = m.person_id;
  if p_approve then
    if l.status = 'archived' then raise exception 'This list is archived. Restore it first.'; end if;
    out := public._put_attendance(l.id, pr.id, 'registrar', true);
    if out->>'status' = 'marked' then
      update public.attendance set marked_at = m.at, marked_by = m.submitted_by, marked_by_name = m.submitted_by_name where id = (out->>'attendance_id')::uuid;
    end if;
  end if;
  update public.late_marks set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now() where id = m.id;
  perform public.log_action(case when p_approve then 'late_mark.approve' else 'late_mark.reject' end, 'list', l.id::text,
    jsonb_build_object('list_title', l.title, 'person', pr.full_name, 'marked_by', m.submitted_by_name, 'at', m.at));
end $$;

-- ---------------------------------------------------------------------------------
-- Attendance history of one person (admins)
-- ---------------------------------------------------------------------------------
create or replace function public.person_history(p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare pr jsonb;
begin
  perform public.need_role(array['admin']);
  pr := public.person_snapshot(p_person);
  if pr is null then raise exception 'Person not found.'; end if;
  return jsonb_build_object(
    'person', pr,
    'attendance', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'event', e.name, 'list', l.title, 'marked_at', a.marked_at,
                     'method', a.method, 'removed', a.removed) order by a.marked_at desc)
                  from public.attendance a join public.lists l on l.id = a.list_id join public.events e on e.id = l.event_id
                 where a.person_id = p_person), '[]'::jsonb),
    'trackers', coalesce((select jsonb_agg(jsonb_build_object('event', te.name, 'list', tl.title, 'removed', x.removed,
                     'dates', (select count(*) from public.tracker_dates d where d.list_id = tl.id and d.removed_at is null),
                     'ticks', (select count(*) from public.tracker_marks m join public.tracker_dates d on d.id = m.date_id
                                where m.entry_id = x.id and d.removed_at is null),
                     'marks', (select coalesce(jsonb_agg(jsonb_build_object('on_date', d.on_date, 'title', d.title, 'marked_at', m.marked_at) order by d.on_date desc), '[]'::jsonb)
                                 from public.tracker_marks m join public.tracker_dates d on d.id = m.date_id
                                where m.entry_id = x.id and d.removed_at is null)) order by te.name, tl.title)
                  from public.tracker_entries x join public.tracker_lists tl on tl.id = x.list_id join public.tracker_events te on te.id = tl.event_id
                 where x.person_id = p_person), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------------
-- Audit log search (admins)
-- ---------------------------------------------------------------------------------
create or replace function public.audit_search(p_q text default null, p_action text default null,
                                               p_from date default null, p_to date default null, p_limit int default 300)
returns setof public.audit_log
language plpgsql stable security definer set search_path = public as $$
declare s text := nullif(btrim(coalesce(p_q, '')), '');
begin
  perform public.need_role(array['admin']);
  return query
    select a.* from public.audit_log a
     where (p_action is null or p_action = '' or a.action like replace(replace(p_action, '%', ''), '_', '\_') || '%')
       and (p_from is null or a.at >= p_from::timestamptz)
       and (p_to is null or a.at < (p_to + 1)::timestamptz)
       and (s is null or a.actor_name ilike '%' || s || '%' or a.action ilike '%' || s || '%' or a.details::text ilike '%' || s || '%')
     order by a.at desc
     limit greatest(1, least(coalesce(p_limit, 300), 1000));
end $$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = any (array['my_recent_actions', 'undo_action', 'tracker_sync_marks', 'attendance_sync',
                                  'late_marks_list', 'decide_late_mark', 'person_history', 'audit_search',
                                  'tracker_set_mark', 'tracker_add_entry', 'tracker_create_person', 'mark_attendance_manual'])
  loop
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
