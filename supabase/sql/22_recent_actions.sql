-- 22: "My recent actions" lists more of what people do, and can undo more of it. Safe to run more than once.
-- Run after 21. Do not run 17 again after this file.

-- 1. Record more actions in the journal (patches single lines; skipped when already patched).
do $$
declare
  patches text[][] := array[
    -- function, line to find, text to insert before it
    ['tracker_remove_entry', 'perform public.log_action(''tracker.entry.remove'', ''tracker_list'', e.list_id::text,',
     'perform public._journal(''tracker.entry.remove'', ''Removed '' || coalesce(nm, ''a person'') || '' from '' || l.title, jsonb_build_object(''entry'', e.id, ''list'', e.list_id));'],
    ['tracker_restore_entry', 'perform public.log_action(''tracker.entry.restore'', ''tracker_list'', e.list_id::text,',
     'perform public._journal(''tracker.entry.restore'', ''Restored '' || coalesce(nm, ''a person'') || '' on '' || l.title, jsonb_build_object(''entry'', e.id, ''list'', e.list_id));'],
    ['tracker_set_date_open', 'perform public.log_action(case when p_open then ''tracker.date.open'' else ''tracker.date.close'' end, ''tracker_list'', l.id::text,',
     'perform public._journal(''tracker.date.open'', case when p_open then ''Opened '' else ''Closed '' end || ''the '' || to_char(d.on_date, ''DD Mon'') || '' column ('' || l.title || '')'', jsonb_build_object(''date'', d.id, ''open'', p_open, ''list'', l.id));'],
    ['tracker_add_date', 'perform public.log_action(''tracker.date.add'', ''tracker_list'', p_list::text,',
     'perform public._journal(''tracker.date'', ''Added the '' || to_char(p_date, ''DD Mon'') || '' column to '' || l.title || case when n > 1 then '' and '' || (n - 1) || '' more list(s)'' else '''' end, jsonb_build_object(''list'', p_list));'],
    ['tracker_update_date', 'perform public.log_action(''tracker.date.edit'', ''tracker_list'', d.list_id::text,',
     'perform public._journal(''tracker.date'', ''Changed the '' || to_char(d.on_date, ''DD Mon'') || '' column to '' || to_char(p_on, ''DD Mon'') || '' ('' || l.title || '')'', jsonb_build_object(''list'', d.list_id));'],
    ['tracker_remove_date', 'perform public.log_action(''tracker.date.remove'', ''tracker_list'', d.list_id::text,',
     'perform public._journal(''tracker.date'', ''Removed the '' || to_char(d.on_date, ''DD Mon'') || '' column from '' || l.title, jsonb_build_object(''list'', d.list_id));'],
    ['tracker_restore_date', 'perform public.log_action(''tracker.date.restore'', ''tracker_list'', d.list_id::text,',
     'perform public._journal(''tracker.date'', ''Restored the '' || to_char(d.on_date, ''DD Mon'') || '' column on '' || l.title, jsonb_build_object(''list'', d.list_id));'],
    ['tracker_set_title', 'where id = p_person;',
     'perform public._journal(''tracker.person'', ''Changed the title of '' || coalesce((select full_name from public.people where id = p_person), ''a person''), jsonb_build_object(''person'', p_person));'],
    ['tracker_add_entry', 'perform public._journal(''tracker.entry'', ''Added '' || pr.full_name || '' to '' || l.title, jsonb_build_object(''entry'', eid, ''list'', p_list, ''was'', status));',
     'NOLABEL']
  ];
  i int; f record; def text; fn text; pat text; ins text; done int := 0;
begin
  for i in 1 .. array_length(patches, 1) loop
    fn := patches[i][1]; pat := patches[i][2]; ins := patches[i][3];
    for f in select p.oid from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = fn loop
      def := pg_get_functiondef(f.oid);
      if fn = 'tracker_add_entry' then
        -- the journal line for adding a person also says how many dates were chosen
        if def like '%dates selected%' then continue; end if;
        if position(pat in def) = 0 then raise exception 'Could not extend %', fn; end if;
        def := replace(def, pat, replace(pat, '''Added '' || pr.full_name || '' to '' || l.title,',
          '''Added '' || pr.full_name || '' to '' || l.title || case when coalesce(cardinality(p_dates), 0) > 0 then '' ('' || cardinality(p_dates) || '' dates selected)'' else '''' end,'));
      else
        if def like '%' || substr(ins, 1, 60) || '%' then continue; end if;
        if position(pat in def) = 0 then raise exception 'Could not extend %', fn; end if;
        def := replace(def, pat, case when fn = 'tracker_set_title' then pat || E'\n  ' || ins else ins || E'\n  ' || pat end);
      end if;
      execute def;
      done := done + 1;
    end loop;
  end loop;
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = any (array['tracker_remove_entry', 'tracker_restore_entry', 'tracker_set_date_open',
              'tracker_add_date', 'tracker_update_date', 'tracker_remove_date', 'tracker_restore_date', 'tracker_set_title', 'tracker_add_entry'])
  loop execute format('grant execute on function %s to authenticated', f.sig); end loop;
end $$;

-- 2. Undo for the new kinds. The existing undo keeps working as before, under a new internal name.
do $$
begin
  if to_regprocedure('public._undo_action_core(uuid)') is null then
    alter function public.undo_action(uuid) rename to _undo_action_core;
  end if;
end $$;
revoke all on function public._undo_action_core(uuid) from public, anon, authenticated;

create or replace function public.undo_action(p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare j public.action_journal%rowtype; e public.tracker_entries%rowtype;
begin
  perform public.need_role(array['admin', 'manager', 'list_manager', 'registrar']);
  select * into j from public.action_journal where id = p_id and actor = auth.uid() for update;
  if found and j.kind in ('tracker.entry.remove', 'tracker.entry.restore', 'tracker.date.open') then
    if j.undone_at is not null then raise exception 'That was already undone.'; end if;
    if j.at < now() - interval '24 hours' then raise exception 'It is too late to undo that. Ask a manager to change it.'; end if;
    if j.kind = 'tracker.date.open' then
      perform public.tracker_set_date_open((j.ref->>'date')::uuid, not (j.ref->>'open')::boolean);
    else
      select * into e from public.tracker_entries where id = (j.ref->>'entry')::uuid;
      if not found then raise exception 'The person is no longer on that list.'; end if;
      if j.kind = 'tracker.entry.remove' then perform public.tracker_restore_entry(e.id);
      else perform public.tracker_remove_entry(e.id); end if;
    end if;
    update public.action_journal set undone_at = now() where id = j.id;
    perform public.log_action('action.undo', 'journal', j.id::text, jsonb_build_object('what', j.label));
    return;
  end if;
  perform public._undo_action_core(p_id);
end $$;
grant execute on function public.undo_action(uuid) to authenticated;

-- 3. A week of history with paging, instead of 3 days and a hard 40.
drop function if exists public.my_recent_actions(int);
create or replace function public.my_recent_actions(p_limit int default 40, p_before timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.need_role(array['admin', 'manager', 'list_manager', 'registrar']);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', j.id, 'at', j.at, 'kind', j.kind, 'label', j.label,
             'undone', j.undone_at is not null,
             'can_undo', j.undone_at is null and j.at > now() - interval '24 hours'
                         and j.kind in ('tracker.mark', 'tracker.entry', 'attendance.mark', 'tracker.entry.remove', 'tracker.entry.restore', 'tracker.date.open'))
           order by j.at desc)
      from (select * from public.action_journal
             where actor = auth.uid() and at > now() - interval '7 days' and (p_before is null or at < p_before)
             order by at desc limit greatest(1, least(coalesce(p_limit, 40), 100))) j), '[]'::jsonb);
end $$;
grant execute on function public.my_recent_actions(int, timestamptz) to authenticated;
