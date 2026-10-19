-- A tracker date counts in attendance figures only once it has STARTED: it has been opened at least once,
-- or it already has ticks (so columns that existed before open/close keep their history). A future date that
-- nobody has opened is left out of percentages, "attended every date", the trend, the absent follow-up and
-- a person's history. Run AFTER 17_open_close_dates.sql. Safe to run again.

alter table public.tracker_dates add column if not exists ever_opened boolean not null default false;
update public.tracker_dates set ever_opened = true where not ever_opened and (is_open or exists (select 1 from public.tracker_date_windows w where w.date_id = tracker_dates.id));

create or replace function public._tracker_mark_opened() returns trigger language plpgsql as $$
begin
  if new.is_open then new.ever_opened := true; end if;
  return new;
end $$;
drop trigger if exists tracker_dates_ever_opened on public.tracker_dates;
create trigger tracker_dates_ever_opened before insert or update on public.tracker_dates
  for each row execute function public._tracker_mark_opened();

do $$
declare f record; d text; n text; nm text;
  s text := 'and (d.ever_opened or exists (select 1 from public.tracker_marks mk where mk.date_id = d.id))';
  pairs text[];
begin
  -- name, then pairs of (old, new). Single-line matches only, so Windows line endings do not matter.
  for nm, pairs in
    select * from (values
      ('tracker_analytics', array[
        'join L on L.id = d.list_id where d.removed_at is null),',
        'join L on L.id = d.list_id where d.removed_at is null ' || s || '),']),
      ('_tracker_event_json', array[
        '''dates'', (select count(*) from public.tracker_dates d where d.list_id = l.id and d.removed_at is null),',
        '''dates'', (select count(*) from public.tracker_dates d where d.list_id = l.id and d.removed_at is null ' || s || '),',
        '''last_date'', (select max(d.on_date) from public.tracker_dates d where d.list_id = l.id and d.removed_at is null),',
        '''last_date'', (select max(d.on_date) from public.tracker_dates d where d.list_id = l.id and d.removed_at is null ' || s || '),',
        'where d.list_id = l.id and d.removed_at is null order by d.on_date desc limit 1))',
        'where d.list_id = l.id and d.removed_at is null ' || s || ' order by d.on_date desc limit 1))']),
      ('person_history', array[
        '''dates'', (select count(*) from public.tracker_dates d where d.list_id = tl.id and d.removed_at is null),',
        '''dates'', (select count(*) from public.tracker_dates d where d.list_id = tl.id and d.removed_at is null ' || s || '),']),
      ('tracker_grid', array[
        '''open'', d.is_open)',
        '''open'', d.is_open, ''started'', (d.ever_opened or exists (select 1 from public.tracker_marks mk where mk.date_id = d.id)))'])
    ) as t(nm, pairs)
  loop
    for f in select p.oid from pg_proc p join pg_namespace s2 on s2.oid = p.pronamespace where s2.nspname = 'public' and p.proname = nm loop
      d := pg_get_functiondef(f.oid);
      if d like '%ever_opened%' then continue; end if;
      n := d;
      for i in 1 .. array_length(pairs, 1) / 2 loop
        if position(pairs[2 * i - 1] in n) = 0 then raise exception 'Could not extend %: % not found', nm, i; end if;
        n := replace(n, pairs[2 * i - 1], pairs[2 * i]);
      end loop;
      execute n;
    end loop;
  end loop;
end $$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any (array['tracker_analytics', 'tracker_overview', 'person_history', 'tracker_grid'])
  loop
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
  revoke all on function public._tracker_mark_opened() from public, anon, authenticated;
end $$;
