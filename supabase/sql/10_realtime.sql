-- Switches on live updates for the tables the screens watch. Run once in the Supabase SQL Editor.
-- Safe to run again. (Same as Database > Replication > supabase_realtime, done for you.)

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['attendance', 'signup_entries', 'signup_lists', 'lists', 'events', 'people', 'accounts', 'audit_log'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
