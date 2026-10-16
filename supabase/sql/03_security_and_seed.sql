-- ============================================================================
-- Attendance Registration System - step 3 of 3: security rules and starter data
-- Run AFTER 02_functions.sql.
--
-- Row Level Security is what really protects the data: the website runs in
-- the browser, so these rules decide who can read what, no matter what the
-- website code does. Nothing is writable from the browser except through the
-- functions in step 2 (admins can edit the lookup lists directly).
-- ============================================================================

-- Start from nothing, then grant only what is needed ------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

grant usage on schema public to authenticated;

grant select on public.accounts, public.areas, public.titles, public.voice_parts,
                public.district_groups, public.district_variants, public.people,
                public.events, public.lists, public.list_secrets, public.attendance,
                public.reviewer_grants, public.audit_log
  to authenticated;
grant insert, update, delete on public.areas, public.titles, public.voice_parts to authenticated;

-- Functions the website may call (everything else stays internal) -----------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = any (array[
         'app_role', 'my_person_id', 'can_review_list', 'can_review_event',
         'suggest_districts', 'save_my_profile', 'clear_must_set_password',
         'get_open_list', 'mark_my_attendance', 'mark_attendance_manual',
         'undo_attendance', 'remove_attendance', 'restore_attendance', 'list_present',
         'search_people', 'create_person', 'update_person', 'archive_person',
         'restore_person', 'delete_person', 'merge_people',
         'create_event', 'rename_event', 'save_list', 'open_list', 'close_list',
         'archive_list', 'unarchive_list', 'delete_list', 'get_qr_payload',
         'set_account_disabled', 'link_account_person', 'grant_reviewer', 'revoke_grant',
         'rename_district', 'merge_districts', 'log_export',
         'my_history', 'event_breakdown', 'district_overview',
         'signup_public_info', 'signup_submit', 'signup_lists_overview', 'signup_get',
         'signup_save', 'signup_set_open', 'signup_new_link', 'signup_delete',
         'signup_entries', 'signup_paste', 'signup_update_entry', 'signup_remove_entry',
         'signup_restore_entry', 'signup_to_person', 'signup_merge_into',
         'delete_event', 'archive_event', 'unarchive_event', 'signup_delete_entry'])
  loop
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

-- The public sign-up page reads its form before anyone signs in (no account, no session yet)
grant usage on schema public to anon;
grant execute on function public.signup_public_info(text) to anon;

-- Row Level Security --------------------------------------------------------
alter table public.areas             enable row level security;
alter table public.titles            enable row level security;
alter table public.voice_parts       enable row level security;
alter table public.district_groups   enable row level security;
alter table public.district_variants enable row level security;
alter table public.people            enable row level security;
alter table public.accounts          enable row level security;
alter table public.events            enable row level security;
alter table public.lists             enable row level security;
alter table public.list_secrets      enable row level security;
alter table public.attendance        enable row level security;
alter table public.reviewer_grants   enable row level security;
alter table public.audit_log         enable row level security;
alter table public.rate_events       enable row level security;   -- no policies: nobody but the functions
alter table public.signup_lists      enable row level security;   -- no policies: only the signup_* functions
alter table public.signup_entries    enable row level security;   -- no policies: only the signup_* functions

-- Accounts: you see your own; admins see all
create policy accounts_select on public.accounts for select to authenticated
  using (id = auth.uid() or public.app_role() = 'admin');

-- Lookups: any signed-in user reads; only admins change
do $$
declare t text;
begin
  foreach t in array array['areas', 'titles', 'voice_parts'] loop
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.app_role() = ''admin'')', t || '_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.app_role() = ''admin'') with check (public.app_role() = ''admin'')', t || '_upd', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.app_role() = ''admin'')', t || '_del', t);
  end loop;
end $$;

-- Districts: names are readable (for suggestions); changes only through functions
create policy district_groups_read   on public.district_groups   for select to authenticated using (true);
create policy district_variants_read on public.district_variants for select to authenticated using (true);

-- People: admins see everyone; everyone else only their own record.
-- (Registrars search through the search_people function, which hides contact details.)
create policy people_select on public.people for select to authenticated
  using (public.app_role() = 'admin' or id = public.my_person_id());

-- Events and lists: admins see all; reviewers see what they were granted
create policy events_select on public.events for select to authenticated
  using (public.app_role() = 'admin' or public.can_review_event(id));
create policy lists_select on public.lists for select to authenticated
  using (public.app_role() = 'admin' or public.can_review_list(id));

-- Secrets (QR token, rotation secret): admins only
create policy list_secrets_select on public.list_secrets for select to authenticated
  using (public.app_role() = 'admin');

-- Attendance: admins all; reviewers granted lists (not removed); members their own
create policy attendance_select on public.attendance for select to authenticated
  using (
    public.app_role() = 'admin'
    or (not removed and public.can_review_list(list_id))
    or (not removed and person_id = public.my_person_id())
  );

create policy reviewer_grants_select on public.reviewer_grants for select to authenticated
  using (public.app_role() = 'admin' or account_id = auth.uid());

create policy audit_log_select on public.audit_log for select to authenticated
  using (public.app_role() = 'admin');

-- Live updates for admin and reviewer screens
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.attendance;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Starter data (admins can edit all of these in the app)
-- ---------------------------------------------------------------------------
insert into public.areas (name, sort) values
  ('East', 1), ('North', 2), ('West', 3), ('South', 4);

insert into public.titles (name, needs_specify, sort) values
  ('Brother', false, 1), ('Sister', false, 2), ('Minister', true, 3);

insert into public.voice_parts (name, sort) values
  ('Soprano I', 1), ('Soprano II', 2), ('Alto I', 3), ('Alto II', 4),
  ('Tenor I', 5), ('Tenor II', 6), ('Bass I', 7), ('Bass II', 8);

-- The server-side invite function uses the service_role. When "Automatically expose
-- new tables" is OFF in Supabase, service_role gets no table access by default, so
-- grant it explicitly. (service_role never reaches the browser.)
grant usage on schema public to service_role;
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
