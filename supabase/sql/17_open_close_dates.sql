-- Open and close tracker date columns. A column must be OPEN to be ticked or unticked, so nobody can
-- back-date a tick. Admins, event managers and list managers open and close columns on their lists.
-- Registrars, event managers and list managers can tick only open columns. An admin can still tick a closed
-- column (an override, shown in the grid and written to the audit log). A tick made offline while the column
-- was open is accepted when it syncs later, judged by the time it was made (2 minutes of clock tolerance).
-- Every column that exists when this runs starts CLOSED. Run AFTER 16_list_manager.sql. Safe to run again.

alter table public.tracker_dates add column if not exists is_open boolean not null default false;

create table if not exists public.tracker_date_windows (
  id         uuid primary key default gen_random_uuid(),
  date_id    uuid not null references public.tracker_dates(id) on delete cascade,
  opened_at  timestamptz not null default now(),
  opened_by  uuid,
  closed_at  timestamptz,
  closed_by  uuid
);
create index if not exists tracker_date_windows_date on public.tracker_date_windows (date_id, opened_at);
alter table public.tracker_date_windows enable row level security;   -- no policies: only the functions below read it

-- Is this column open at that moment? Admin gets 'override' on a closed one, everyone else is refused.
create or replace function public._tracker_date_check(p_date uuid, p_at timestamptz default null) returns text
language plpgsql stable security definer set search_path = public, extensions as $$
declare t timestamptz := coalesce(p_at, now()); tol interval := case when p_at is null then interval '0' else interval '2 minutes' end; ok boolean;
begin
  if t > now() then t := now(); end if;
  select exists (select 1 from public.tracker_date_windows w
                  where w.date_id = p_date and t >= w.opened_at - tol and (w.closed_at is null or t <= w.closed_at + tol)) into ok;
  if ok then return 'open'; end if;
  if public.app_role() = 'admin' then return 'override'; end if;
  raise exception 'Registration for this date is closed. Ask a manager to open it.';
end $$;

create or replace function public.tracker_set_date_open(p_date uuid, p_open boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare d public.tracker_dates%rowtype; l public.tracker_lists%rowtype;
begin
  select * into d from public.tracker_dates where id = p_date;
  if not found then raise exception 'That date was not found.'; end if;
  l := public._tracker_guard(d.list_id, 'manage');
  perform public.rate_check('tracker_date_open', 120, 60);
  if d.removed_at is not null then raise exception 'That date was removed.'; end if;
  if p_open then
    if d.is_open then return jsonb_build_object('open', true); end if;
    insert into public.tracker_date_windows (date_id, opened_by) values (d.id, auth.uid());
    update public.tracker_dates set is_open = true where id = d.id;
  else
    if not d.is_open then return jsonb_build_object('open', false); end if;
    update public.tracker_date_windows set closed_at = now(), closed_by = auth.uid() where date_id = d.id and closed_at is null;
    update public.tracker_dates set is_open = false where id = d.id;
  end if;
  perform public.log_action(case when p_open then 'tracker.date.open' else 'tracker.date.close' end, 'tracker_list', l.id::text,
    jsonb_build_object('list_title', l.title, 'date', d.on_date, 'title', d.title));
  return jsonb_build_object('open', p_open);
end $$;

-- A column that is removed is closed too
create or replace function public._tracker_close_removed() returns trigger language plpgsql as $$
begin
  if new.removed_at is not null and new.is_open then
    new.is_open := false;
    update public.tracker_date_windows set closed_at = now() where date_id = new.id and closed_at is null;
  end if;
  return new;
end $$;
drop trigger if exists tracker_dates_close_removed on public.tracker_dates;
create trigger tracker_dates_close_removed before update on public.tracker_dates
  for each row execute function public._tracker_close_removed();

-- The tick itself
create or replace function public.tracker_set_mark(p_entry uuid, p_date uuid, p_on boolean, p_at timestamptz default null) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare e public.tracker_entries%rowtype; d public.tracker_dates%rowtype; who text; pn text; lt text; n int; chk text;
begin
  select * into e from public.tracker_entries where id = p_entry;
  if not found then raise exception 'Person not found on this list.'; end if;
  perform public._tracker_guard(e.list_id, 'mark');
  select * into d from public.tracker_dates where id = p_date;
  if not found or d.list_id <> e.list_id then raise exception 'That date is not on this list.'; end if;
  if d.removed_at is not null then raise exception 'That date was removed.'; end if;
  if e.removed then raise exception 'This person was removed from the list.'; end if;
  chk := public._tracker_date_check(d.id, p_at);
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
    perform public._journal('tracker.mark', case when p_on then 'Ticked ' else 'Unticked ' end || pn || ' on ' || to_char(d.on_date, 'DD Mon') || ' (' || lt || ')'
      || case when chk = 'override' then ' [column closed, admin override]' else '' end,
      jsonb_build_object('entry', e.id, 'date', d.id, 'on', p_on, 'list', e.list_id));
    if chk = 'override' then
      perform public.log_action('tracker.mark.override', 'tracker_list', e.list_id::text,
        jsonb_build_object('list_title', lt, 'person', pn, 'date', d.on_date, 'on', p_on));
    end if;
  end if;
end $$;

-- Ticking dates for a person who is being added: only open columns (an admin may tick closed ones)
create or replace function public._tracker_tick_many(p_entry uuid, p_list uuid, p_dates uuid[]) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare who text; adm boolean := public.app_role() = 'admin';
begin
  if p_dates is null or cardinality(p_dates) = 0 then return; end if;
  select coalesce(nullif(full_name, ''), email) into who from public.accounts where id = auth.uid();
  insert into public.tracker_marks (entry_id, date_id, list_id, marked_by, marked_by_name)
  select p_entry, d.id, p_list, auth.uid(), who
    from public.tracker_dates d
   where d.id = any(p_dates) and d.list_id = p_list and d.removed_at is null and (d.is_open or adm)
  on conflict do nothing;
end $$;

-- The grid and undo learn about open columns
do $$
declare f record; d text; n text;
begin
  for f in select p.oid from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'tracker_grid' loop
    d := pg_get_functiondef(f.oid);
    if d not like '%''open'', d.is_open%' then
      n := replace(d, '''removed'', d.removed_at is not null)', '''removed'', d.removed_at is not null, ''open'', d.is_open)');
      n := replace(n, '''contact'', see_contact),', '''contact'', see_contact, ''override'', r = ''admin''),');
      if n = d or n not like '%''open'', d.is_open%' or n not like '%''override''%' then raise exception 'Could not extend tracker_grid'; end if;
      execute n;
    end if;
  end loop;
  for f in select p.oid from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'undo_action' loop
    d := pg_get_functiondef(f.oid);
    if d not like '%_tracker_date_check%' then
      -- single-line match, so it also works when the function was saved with Windows line endings
      n := replace(d, 'if (j.ref->>''on'')::boolean then',
                      'perform public._tracker_date_check((j.ref->>''date'')::uuid, null); if (j.ref->>''on'')::boolean then');
      if n = d then raise exception 'Could not extend undo_action'; end if;
      execute n;
    end if;
  end loop;
end $$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = any (array['tracker_set_date_open', 'tracker_set_mark', 'tracker_grid', 'undo_action', 'tracker_sync_marks',
                                  'tracker_add_entry', 'tracker_create_person'])
  loop
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
  revoke all on function public._tracker_date_check(uuid, timestamptz) from public, anon, authenticated;
  revoke all on function public._tracker_tick_many(uuid, uuid, uuid[]) from public, anon, authenticated;
  revoke all on function public._tracker_close_removed() from public, anon, authenticated;
end $$;
