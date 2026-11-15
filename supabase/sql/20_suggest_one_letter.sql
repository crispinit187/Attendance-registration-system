-- Suggestions for districts and congregations now start from the FIRST letter typed (they needed two),
-- and show up to 8 matches. Run AFTER 19_tracker_team_lists.sql. Safe to run again.
do $$
declare f record; d text; n text; nm text;
begin
  foreach nm in array array['suggest_districts', 'suggest_congregations'] loop
    for f in select p.oid from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = nm loop
      d := pg_get_functiondef(f.oid);
      if d like '%char_length(n) < 1%' then continue; end if;
      n := replace(replace(d, 'char_length(n) < 2', 'char_length(n) < 1'), 'limit 5', 'limit 8');
      if n = d then raise exception 'Could not extend %', nm; end if;
      execute n;
    end loop;
  end loop;
end $$;
grant execute on function public.suggest_districts(text), public.suggest_congregations(text) to authenticated;
