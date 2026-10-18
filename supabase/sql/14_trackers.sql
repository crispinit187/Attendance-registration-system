-- ============================================================================
-- Trackers, list managers, congregations and spreadsheet import
-- Run once in the Supabase SQL Editor, AFTER 01, 02 and 03 (also on a brand new install).
-- Safe to run again.
--
-- What this adds
--   * Tracker events: an event with several lists. Each list is a grid of people (rows) and dates
--     (columns) with a tick for each date. Attendance is cumulative over the dates.
--   * A new role, List manager, who manages the lists an admin gives them.
--   * Event and list registrars and reviewers: the existing roles, given a tracker event or list.
--   * Congregation (free text with the same spelling matching as districts), and Title is optional.
--   * Voice spellings ("2nd Bass" = Bass II), spreadsheet import into a tracker, and a
--     "Possible duplicates" check for the people register.
--   * Analytics for a whole tracker event or one list.
-- ============================================================================

-- 1. Role -------------------------------------------------------------------
alter table public.accounts drop constraint if exists accounts_role_check;
alter table public.accounts add constraint accounts_role_check
  check (role in ('admin','manager','list_manager','reviewer','registrar','member'));

-- 2. Congregations: one canonical name plus every spelling matched to it ------
create table if not exists public.congregation_groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists congregation_groups_name_key on public.congregation_groups (lower(name));

create table if not exists public.congregation_variants (
  id       uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.congregation_groups(id) on delete cascade,
  variant  text not null unique
);
create index if not exists congregation_variants_group on public.congregation_variants (group_id);
create index if not exists congregation_variants_trgm on public.congregation_variants using gin (variant extensions.gin_trgm_ops);

alter table public.people add column if not exists congregation_group_id uuid references public.congregation_groups(id);
create index if not exists people_congregation on public.people (congregation_group_id);

-- Spellings of a voice part that an admin matched by hand ("Baritone" = Bass I)
create table if not exists public.voice_aliases (
  alias         text primary key,
  voice_part_id uuid not null references public.voice_parts(id) on delete cascade
);

-- Pairs an admin said are different people, so they are not suggested again
create table if not exists public.people_not_duplicates (
  a uuid not null references public.people(id) on delete cascade,
  b uuid not null references public.people(id) on delete cascade,
  primary key (a, b),
  check (a < b)
);

-- 3. Tracker tables ---------------------------------------------------------
create table if not exists public.tracker_events (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) >= 2),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists public.tracker_lists (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.tracker_events(id) on delete cascade,
  title      text not null check (char_length(btrim(title)) >= 2),
  expected   int check (expected is null or expected >= 0),
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists tracker_lists_event on public.tracker_lists (event_id);

-- A date column of one list. Removing one hides it (and can be undone); its ticks are kept.
create table if not exists public.tracker_dates (
  id         uuid primary key default gen_random_uuid(),
  list_id    uuid not null references public.tracker_lists(id) on delete cascade,
  on_date    date not null,
  title      text,
  removed_at timestamptz,
  removed_by uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (list_id, on_date)
);

-- A person on a list (a row of the grid)
create table if not exists public.tracker_entries (
  id         uuid primary key default gen_random_uuid(),
  list_id    uuid not null references public.tracker_lists(id) on delete cascade,
  person_id  uuid not null references public.people(id),
  added_by   uuid,
  added_at   timestamptz not null default now(),
  removed    boolean not null default false,
  removed_by uuid,
  removed_at timestamptz,
  unique (list_id, person_id)
);
create index if not exists tracker_entries_person on public.tracker_entries (person_id);

-- A tick: this person was present on this date
create table if not exists public.tracker_marks (
  entry_id       uuid not null references public.tracker_entries(id) on delete cascade,
  date_id        uuid not null references public.tracker_dates(id) on delete cascade,
  list_id        uuid not null references public.tracker_lists(id) on delete cascade,
  marked_by      uuid,
  marked_by_name text,
  marked_at      timestamptz not null default now(),
  primary key (entry_id, date_id)
);
create index if not exists tracker_marks_list on public.tracker_marks (list_id);
create index if not exists tracker_marks_date on public.tracker_marks (date_id);

-- 4. Access grants also cover tracker events and tracker lists -----------------
alter table public.reviewer_grants add column if not exists tracker_event_id uuid references public.tracker_events(id) on delete cascade;
alter table public.reviewer_grants add column if not exists tracker_list_id  uuid references public.tracker_lists(id)  on delete cascade;
alter table public.reviewer_grants drop constraint if exists reviewer_grants_check;
alter table public.reviewer_grants drop constraint if exists reviewer_grants_one_target;
alter table public.reviewer_grants add constraint reviewer_grants_one_target
  check ((event_id is not null)::int + (list_id is not null)::int + (signup_list_id is not null)::int
       + (tracker_event_id is not null)::int + (tracker_list_id is not null)::int = 1);
create unique index if not exists reviewer_grants_tevent_key on public.reviewer_grants (account_id, tracker_event_id) where tracker_event_id is not null;
create unique index if not exists reviewer_grants_tlist_key  on public.reviewer_grants (account_id, tracker_list_id)  where tracker_list_id  is not null;

-- 5. Row Level Security and live updates -----------------------------------------
alter table public.congregation_groups    enable row level security;
alter table public.congregation_variants  enable row level security;
alter table public.voice_aliases          enable row level security;
alter table public.people_not_duplicates  enable row level security;
alter table public.tracker_events         enable row level security;
alter table public.tracker_lists          enable row level security;
alter table public.tracker_dates          enable row level security;
alter table public.tracker_entries        enable row level security;
alter table public.tracker_marks          enable row level security;

-- 6. Congregation matching (same idea as districts) ------------------------------
create or replace function public.normalize_congregation(p text) returns text
language sql immutable as $$
  select btrim(regexp_replace(
           regexp_replace(
             regexp_replace(lower(coalesce(p, '')), '\m(congregations?|assembly|church|the)\M', ' ', 'g'),
             '[^a-z0-9 ]', ' ', 'g'),
           '\s+', ' ', 'g'))
$$;

-- Find the congregation a spelling belongs to, without creating anything
create or replace function public._cong_find(p_n text) returns uuid
language plpgsql stable security definer set search_path = public, extensions as $$
declare gid uuid; tol int;
begin
  if char_length(coalesce(p_n, '')) < 2 then return null; end if;
  select group_id into gid from public.congregation_variants where variant = p_n;
  if gid is not null then return gid; end if;
  tol := case when char_length(p_n) <= 6 then 1 when char_length(p_n) <= 10 then 2 else 3 end;
  select v.group_id into gid
    from public.congregation_variants v
   where public.district_tokens(v.variant) = public.district_tokens(p_n)
     and (levenshtein(v.variant, p_n) <= tol or similarity(v.variant, p_n) >= 0.6)
   order by levenshtein(v.variant, p_n), similarity(v.variant, p_n) desc
   limit 1;
  return gid;
end $$;

create or replace function public._district_find(p_n text) returns uuid
language plpgsql stable security definer set search_path = public, extensions as $$
declare gid uuid; tol int;
begin
  if char_length(coalesce(p_n, '')) < 2 then return null; end if;
  select group_id into gid from public.district_variants where variant = p_n;
  if gid is not null then return gid; end if;
  tol := case when char_length(p_n) <= 6 then 1 when char_length(p_n) <= 10 then 2 else 3 end;
  select v.group_id into gid
    from public.district_variants v
   where public.district_tokens(v.variant) = public.district_tokens(p_n)
     and (levenshtein(v.variant, p_n) <= tol or similarity(v.variant, p_n) >= 0.6)
   order by levenshtein(v.variant, p_n), similarity(v.variant, p_n) desc
   limit 1;
  return gid;
end $$;

-- A free-text congregation becomes one group. Empty text means "not given".
create or replace function public.resolve_congregation(p_raw text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare n text; gid uuid;
begin
  n := left(public.normalize_congregation(p_raw), 80);
  if char_length(n) < 2 then return null; end if;
  gid := public._cong_find(n);
  if gid is null then
    insert into public.congregation_groups (name) values (initcap(n))
      on conflict (lower(name)) do nothing
      returning id into gid;
    if gid is null then
      select id into gid from public.congregation_groups where lower(name) = lower(initcap(n));
    end if;
  end if;
  insert into public.congregation_variants (group_id, variant) values (gid, n)
    on conflict (variant) do nothing;
  return gid;
end $$;

create or replace function public.suggest_congregations(p_q text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare n text; res jsonb;
begin
  if auth.uid() is null then raise exception 'Please sign in.'; end if;
  perform public.rate_check('suggest', 120, 60);
  n := left(public.normalize_congregation(p_q), 60);
  if char_length(n) < 2 then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', x.gid, 'name', x.gname) order by x.score desc, x.gname), '[]'::jsonb)
    into res
    from (
      select g.id as gid, g.name as gname,
             (select max(similarity(v.variant, n)) from public.congregation_variants v where v.group_id = g.id) as score
        from public.congregation_groups g
       where exists (
         select 1 from public.congregation_variants v
          where v.group_id = g.id
            and (v.variant like n || '%' or v.variant like '% ' || n || '%' or similarity(v.variant, n) >= 0.35))
       order by score desc, g.name
       limit 5
    ) x;
  return res;
end $$;

create or replace function public.congregation_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.need_role(array['admin']);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', g.id, 'name', g.name,
             'people', (select count(*) from public.people p where p.congregation_group_id = g.id),
             'variants', (select coalesce(jsonb_agg(v.variant order by v.variant), '[]'::jsonb)
                            from public.congregation_variants v where v.group_id = g.id))
           order by g.name)
      from public.congregation_groups g), '[]'::jsonb);
end $$;

create or replace function public.rename_congregation(p_id uuid, p_name text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare g public.congregation_groups%rowtype; n text := btrim(coalesce(p_name, ''));
begin
  perform public.need_role(array['admin']);
  if char_length(n) < 2 then raise exception 'Please enter a congregation name.'; end if;
  select * into g from public.congregation_groups where id = p_id;
  if not found then raise exception 'Congregation not found.'; end if;
  if exists (select 1 from public.congregation_groups where lower(name) = lower(n) and id <> p_id) then
    raise exception 'A congregation with that name already exists. Use Merge instead.';
  end if;
  update public.congregation_groups set name = n where id = p_id;
  insert into public.congregation_variants (group_id, variant)
    values (p_id, left(public.normalize_congregation(n), 80)) on conflict (variant) do nothing;
  perform public.log_action('congregation.rename', 'congregation', p_id::text, jsonb_build_object('from', g.name, 'to', n));
end $$;

create or replace function public.merge_congregations(p_from uuid, p_to uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare f public.congregation_groups%rowtype; t public.congregation_groups%rowtype;
begin
  perform public.need_role(array['admin']);
  if p_from = p_to then raise exception 'Choose two different congregations.'; end if;
  select * into f from public.congregation_groups where id = p_from;
  select * into t from public.congregation_groups where id = p_to;
  if f.id is null or t.id is null then raise exception 'Congregation not found.'; end if;
  update public.congregation_variants set group_id = p_to where group_id = p_from;
  update public.people set congregation_group_id = p_to where congregation_group_id = p_from;
  delete from public.congregation_groups where id = p_from;
  perform public.log_action('congregation.merge', 'congregation', p_to::text, jsonb_build_object('merged', f.name, 'into', t.name));
end $$;

-- A congregation or district nobody uses can be removed (admins)
create or replace function public.delete_congregation(p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare g public.congregation_groups%rowtype;
begin
  perform public.need_role(array['admin']);
  select * into g from public.congregation_groups where id = p_id;
  if not found then return; end if;
  if exists (select 1 from public.people where congregation_group_id = p_id) then
    raise exception 'People still belong to this congregation. Merge it into another one instead.';
  end if;
  delete from public.congregation_groups where id = p_id;
  perform public.log_action('congregation.delete', 'congregation', p_id::text, jsonb_build_object('name', g.name));
end $$;

-- 7. Voice and area spellings ----------------------------------------------------
-- "2nd Bass", "II bass", "Bass 2", "second bass" all mean Bass II. Anything else needs a
-- hand-made match (kept in voice_aliases so it is remembered).
create or replace function public.resolve_voice(p_raw text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare n text; base text; num text; vid uuid;
begin
  n := lower(btrim(coalesce(p_raw, '')));
  if n = '' then return null; end if;
  select voice_part_id into vid from public.voice_aliases where alias = left(regexp_replace(n, '[^a-z0-9]+', '', 'g'), 60);
  if vid is not null then return vid; end if;
  n := regexp_replace(n, '([a-z])([0-9])', '\1 \2', 'g');
  n := regexp_replace(n, '([0-9])([a-z])', '\1 \2', 'g');
  n := regexp_replace(n, '(soprano|alto|tenor|bass)(ii|i)(?![a-z])', '\1 \2', 'g');
  base := (regexp_match(n, '(soprano|alto|tenor|bass)'))[1];
  if base is null then return null; end if;
  num := case
           when n ~ '(^|[^a-z0-9])(2|2nd|ii|second|two)([^a-z0-9]|$)' then 'II'
           when n ~ '(^|[^a-z0-9])(1|1st|i|first|one)([^a-z0-9]|$)' then 'I'
           else null end;
  if num is null then return null; end if;
  select id into vid from public.voice_parts where active and lower(name) = lower(initcap(base) || ' ' || num);
  return vid;
end $$;

create or replace function public.resolve_area(p_raw text) returns uuid
language sql stable security definer set search_path = public as $$
  select a.id from public.areas a
   where a.active
     and position(' ' || lower(a.name) || ' ' in ' ' || btrim(regexp_replace(lower(coalesce(p_raw, '')), '[^a-z]+', ' ', 'g')) || ' ') > 0
   order by char_length(a.name) desc
   limit 1
$$;

create or replace function public._cap_words(p text) returns text
language sql immutable as $$
  select coalesce(string_agg(upper(left(w, 1)) || substr(w, 2), ' '), '')
    from unnest(string_to_array(btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g')), ' ')) as w
$$;

-- 8. Who can see and change trackers ------------------------------------------------
-- Admins: everything. Registrars and reviewers: every tracker ("All") or only what they were given.
-- Event managers and list managers: only what they were given. A tracker event covers its lists.
create or replace function public.tracker_event_access(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.accounts a
    where a.id = auth.uid() and not a.disabled
      and (a.role = 'admin'
           or (a.role in ('registrar', 'reviewer') and a.access_scope = 'all')
           or (a.role in ('registrar', 'reviewer', 'manager', 'list_manager')
               and exists (select 1 from public.reviewer_grants g
                            where g.account_id = a.id
                              and (g.tracker_event_id = p_event
                                   or g.tracker_list_id in (select l.id from public.tracker_lists l where l.event_id = p_event)))))
  )
$$;

create or replace function public.tracker_list_access(p_list uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.accounts a
    where a.id = auth.uid() and not a.disabled
      and (a.role = 'admin'
           or (a.role in ('registrar', 'reviewer') and a.access_scope = 'all')
           or (a.role in ('registrar', 'reviewer', 'manager', 'list_manager')
               and exists (select 1 from public.reviewer_grants g
                            where g.account_id = a.id
                              and (g.tracker_list_id = p_list
                                   or g.tracker_event_id = (select l.event_id from public.tracker_lists l where l.id = p_list)))))
  )
$$;

-- May this person create, rename and delete the lists of a tracker event? Admins and the event's managers.
create or replace function public.tracker_can_edit_event(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.accounts a
    where a.id = auth.uid() and not a.disabled
      and (a.role = 'admin'
           or (a.role = 'manager'
               and exists (select 1 from public.reviewer_grants g where g.account_id = a.id and g.tracker_event_id = p_event)))
  )
$$;

-- One check used by every tracker action: access, what the role may do, and not archived.
create or replace function public._tracker_guard(p_list uuid, p_need text) returns public.tracker_lists
language plpgsql stable security definer set search_path = public as $$
declare r text := public.app_role(); l public.tracker_lists%rowtype; arch timestamptz;
begin
  select * into l from public.tracker_lists where id = p_list;
  if r is null or not found or not public.tracker_list_access(p_list) then
    raise exception 'You do not have access to that.' using errcode = '42501';
  end if;
  if p_need = 'mark' and r not in ('admin', 'manager', 'list_manager', 'registrar') then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  if p_need = 'manage' and r not in ('admin', 'manager', 'list_manager') then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  if p_need in ('mark', 'manage') then
    select archived_at into arch from public.tracker_events where id = l.event_id;
    if arch is not null then raise exception 'This event is archived. Restore it to make changes.'; end if;
  end if;
  return l;
end $$;

drop policy if exists tracker_events_select on public.tracker_events;
create policy tracker_events_select on public.tracker_events for select to authenticated
  using (public.tracker_event_access(id));
drop policy if exists tracker_lists_select on public.tracker_lists;
create policy tracker_lists_select on public.tracker_lists for select to authenticated
  using (public.tracker_list_access(id));
drop policy if exists tracker_dates_select on public.tracker_dates;
create policy tracker_dates_select on public.tracker_dates for select to authenticated
  using (public.tracker_list_access(list_id));
drop policy if exists tracker_entries_select on public.tracker_entries;
create policy tracker_entries_select on public.tracker_entries for select to authenticated
  using (public.tracker_list_access(list_id));
drop policy if exists tracker_marks_select on public.tracker_marks;
create policy tracker_marks_select on public.tracker_marks for select to authenticated
  using (public.tracker_list_access(list_id));
drop policy if exists congregation_groups_read on public.congregation_groups;
create policy congregation_groups_read on public.congregation_groups for select to authenticated using (true);
drop policy if exists congregation_variants_read on public.congregation_variants;
create policy congregation_variants_read on public.congregation_variants for select to authenticated using (true);
drop policy if exists voice_aliases_read on public.voice_aliases;
create policy voice_aliases_read on public.voice_aliases for select to authenticated using (public.app_role() = 'admin');

grant select on public.tracker_events, public.tracker_lists, public.tracker_dates, public.tracker_entries,
                public.tracker_marks, public.congregation_groups, public.congregation_variants,
                public.voice_aliases
  to authenticated;

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['tracker_events', 'tracker_lists', 'tracker_dates', 'tracker_entries', 'tracker_marks'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- 9. Accounts: the List manager role ---------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text := coalesce(new.raw_app_meta_data->>'role', 'member');
begin
  -- Visitors of the public sign-up page are anonymous sessions: they never get an account.
  if coalesce(new.is_anonymous, false) then return new; end if;
  if r not in ('admin', 'manager', 'list_manager', 'reviewer', 'registrar', 'member') then r := 'member'; end if;
  insert into public.accounts (id, email, full_name, role, access_scope)
  values (new.id, new.email, nullif(btrim(coalesce(new.raw_user_meta_data->>'full_name', '')), ''), r,
          case when r in ('reviewer', 'manager', 'list_manager') then 'selected' else 'all' end)
  on conflict (id) do nothing;
  return new;
end $$;

create or replace function public.change_role(p_id uuid, p_role text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a public.accounts%rowtype; scope text; removed int := 0;
begin
  perform public.need_role(array['admin']);
  if p_role is null or p_role not in ('admin', 'manager', 'list_manager', 'reviewer', 'registrar', 'member') then
    raise exception 'Unknown role.';
  end if;
  select * into a from public.accounts where id = p_id for update;
  if not found then raise exception 'Account not found.'; end if;
  if p_id = auth.uid() then raise exception 'You cannot change your own role.'; end if;
  if a.role = p_role then raise exception 'This account already has that role.'; end if;
  if a.role = 'admin' and not exists (select 1 from public.accounts where role = 'admin' and not disabled and id <> p_id) then
    raise exception 'This is the only admin. Make someone else an admin first.';
  end if;

  -- Event managers and list managers always work with what is selected. Registrars and reviewers keep the
  -- type they had when moving between staff roles; people coming from admin or member start from the usual default.
  scope := case
             when p_role in ('manager', 'list_manager') then 'selected'
             when a.role in ('registrar', 'reviewer', 'manager', 'list_manager') and p_role in ('registrar', 'reviewer') then a.access_scope
             when p_role = 'reviewer' then 'selected'
             else 'all'
           end;

  -- Remove access the new role cannot use: everything for admin and member; single lists for an event manager;
  -- attendance events, attendance lists and sign-up lists for a list manager; sign-up lists for a reviewer.
  delete from public.reviewer_grants g
   where g.account_id = p_id
     and (p_role in ('admin', 'member')
          or (p_role = 'manager' and (g.list_id is not null or g.tracker_list_id is not null))
          or (p_role = 'list_manager' and (g.event_id is not null or g.list_id is not null or g.signup_list_id is not null))
          or (p_role = 'reviewer' and g.signup_list_id is not null));
  get diagnostics removed = row_count;

  update public.accounts set role = p_role, access_scope = scope where id = p_id;
  perform public.log_action('account.role', 'account', p_id::text,
    jsonb_build_object('email', a.email, 'from', a.role, 'to', p_role, 'access_removed', removed));
  return jsonb_build_object('from', a.role, 'to', p_role, 'access_removed', removed, 'scope', scope);
end $$;

create or replace function public.revoke_grant(p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare g public.reviewer_grants%rowtype;
begin
  perform public.need_role(array['admin']);
  select * into g from public.reviewer_grants where id = p_id;
  if not found then return; end if;
  delete from public.reviewer_grants where id = p_id;
  perform public.log_action('grant.remove', 'account', g.account_id::text,
    jsonb_build_object('event_id', g.event_id, 'list_id', g.list_id, 'signup_list_id', g.signup_list_id,
                       'tracker_event_id', g.tracker_event_id, 'tracker_list_id', g.tracker_list_id));
end $$;

-- Give someone a tracker event or one tracker list.
-- Event managers: a whole tracker event. List managers: a whole tracker event or one list.
-- Registrars and reviewers: either.
create or replace function public.grant_tracker_access(p_account uuid, p_event uuid, p_list uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare a public.accounts%rowtype;
begin
  perform public.need_role(array['admin']);
  select * into a from public.accounts where id = p_account;
  if not found or a.role not in ('registrar', 'reviewer', 'manager', 'list_manager') then
    raise exception 'Choose an event manager, list manager, registrar or reviewer account.';
  end if;
  if (p_event is not null)::int + (p_list is not null)::int <> 1 then
    raise exception 'Choose one tracker event or one tracker list.';
  end if;
  if p_list is not null and a.role = 'manager' then
    raise exception 'Give an event manager a whole tracker event.';
  end if;
  if p_event is not null and not exists (select 1 from public.tracker_events where id = p_event) then raise exception 'Tracker event not found.'; end if;
  if p_list is not null and not exists (select 1 from public.tracker_lists where id = p_list) then raise exception 'Tracker list not found.'; end if;
  insert into public.reviewer_grants (account_id, tracker_event_id, tracker_list_id, created_by)
  values (p_account, p_event, p_list, auth.uid())
  on conflict do nothing;
  perform public.log_action('grant.add', 'account', p_account::text,
    jsonb_build_object('email', a.email, 'tracker_event_id', p_event, 'tracker_list_id', p_list));
end $$;

-- Who works on a tracker event or list. A list shows its own team plus the team of its event.
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
             'level', case when g.tracker_list_id is not null then 'list' else 'event' end)
           order by (a.role in ('manager', 'list_manager')) desc, a.role, coalesce(nullif(a.full_name, ''), a.email))
      from public.reviewer_grants g join public.accounts a on a.id = g.account_id
     where (p_list is null and g.tracker_event_id = p_event)
        or (p_list is not null and (g.tracker_list_id = p_list or g.tracker_event_id = p_event))), '[]'::jsonb);
end $$;

-- 10. People: Title optional, Congregation, and tidier merging -----------------------------
create or replace function public._clean_specify(p_title uuid, p_specify text) returns text
language plpgsql stable security definer set search_path = public as $$
declare t public.titles%rowtype;
begin
  if p_title is null then return null; end if;     -- a title is optional
  select * into t from public.titles where id = p_title and active;
  if not found then raise exception 'Please choose a title.'; end if;
  if t.needs_specify then
    if p_specify is null or char_length(btrim(p_specify)) < 2 then
      raise exception 'Please specify (for example Evangelist).';
    end if;
    return left(btrim(p_specify), 60);
  end if;
  return null;
end $$;

create or replace function public.person_snapshot(p_person uuid) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'person_id', p.id,
    'title', t.name,
    'title_specify', p.title_specify,
    'full_name', p.full_name,
    'display_name', public.display_name(t.name, p.title_specify, p.full_name),
    'area_id', p.area_id,
    'area', a.name,
    'district', g.name,
    'congregation', cg.name,
    'voice_part_id', p.voice_part_id,
    'voice_part', v.name,
    'contact', p.contact)
  from public.people p
  left join public.titles t on t.id = p.title_id
  left join public.areas a on a.id = p.area_id
  left join public.district_groups g on g.id = p.district_group_id
  left join public.congregation_groups cg on cg.id = p.congregation_group_id
  left join public.voice_parts v on v.id = p.voice_part_id
  where p.id = p_person
$$;

drop function if exists public.create_person(uuid, text, text, uuid, uuid, text, text, boolean);
create or replace function public.create_person(
  p_title_id uuid, p_title_specify text, p_full_name text, p_area_id uuid,
  p_voice_part_id uuid, p_district text, p_contact text, p_force boolean default false,
  p_congregation text default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare nm text; spec text; dg uuid; cg uuid; c text; pid uuid; sim_matches jsonb;
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
  cg := public.resolve_congregation(p_congregation);
  c := public.normalize_contact(p_contact);
  insert into public.people (title_id, title_specify, full_name, area_id, district_group_id, congregation_group_id,
                             voice_part_id, contact, created_by)
  values (p_title_id, spec, nm, p_area_id, dg, cg, p_voice_part_id, c, auth.uid())
  returning id into pid;
  return jsonb_build_object('status', 'created', 'id', pid);
end $$;

drop function if exists public.update_person(uuid, uuid, text, text, uuid, uuid, text, text);
create or replace function public.update_person(
  p_id uuid, p_title_id uuid, p_title_specify text, p_full_name text, p_area_id uuid,
  p_voice_part_id uuid, p_district text, p_contact text, p_congregation text default null
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r text; pr public.people%rowtype; spec text; dg uuid; cg uuid; c text; nm text;
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
  cg := public.resolve_congregation(p_congregation);
  c := public.normalize_contact(p_contact);
  update public.people
     set title_id = p_title_id, title_specify = spec, full_name = nm, area_id = p_area_id,
         district_group_id = dg, congregation_group_id = cg, voice_part_id = p_voice_part_id, contact = c,
         updated_at = now()
   where id = p_id;
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
  if exists (select 1 from public.attendance where person_id = p_id)
     or exists (select 1 from public.tracker_entries where person_id = p_id) then
    raise exception 'This person has attendance history. Archive them instead.';
  end if;
  if exists (select 1 from public.accounts where person_id = p_id) then
    raise exception 'This person has a login account. Archive them instead.';
  end if;
  delete from public.people where id = p_id;
  perform public.log_action('person.delete', 'person', p_id::text,
    jsonb_build_object('person', pr.full_name));
end $$;

-- Admin: join two records of the same person. Attendance, tracker lists and ticks move to the kept
-- record, and anything the kept record lacks (voice, district, congregation...) is filled from the other.
create or replace function public.merge_people(p_keep uuid, p_merge uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare k public.people%rowtype; m public.people%rowtype; r record;
        ka uuid; ma uuid; kentry uuid;
begin
  perform public.need_role(array['admin']);
  if p_keep = p_merge then raise exception 'Choose two different people.'; end if;
  select * into k from public.people where id = p_keep;
  select * into m from public.people where id = p_merge;
  if k.id is null or m.id is null then raise exception 'Person not found.'; end if;
  select id into ka from public.accounts where person_id = p_keep;
  select id into ma from public.accounts where person_id = p_merge;
  if ka is not null and ma is not null then
    raise exception 'Both people have login accounts. Merge is not possible.';
  end if;
  for r in select * from public.attendance where person_id = p_merge loop
    if exists (select 1 from public.attendance where list_id = r.list_id and person_id = p_keep) then
      delete from public.attendance where id = r.id;
    else
      update public.attendance set person_id = p_keep where id = r.id;
    end if;
  end loop;
  for r in select * from public.tracker_entries where person_id = p_merge loop
    select id into kentry from public.tracker_entries where list_id = r.list_id and person_id = p_keep;
    if kentry is not null then
      insert into public.tracker_marks (entry_id, date_id, list_id, marked_by, marked_by_name, marked_at)
        select kentry, mk.date_id, mk.list_id, mk.marked_by, mk.marked_by_name, mk.marked_at
          from public.tracker_marks mk where mk.entry_id = r.id
        on conflict do nothing;
      if not r.removed then
        update public.tracker_entries set removed = false, removed_by = null, removed_at = null where id = kentry;
      end if;
      delete from public.tracker_entries where id = r.id;
    else
      update public.tracker_entries set person_id = p_keep where id = r.id;
    end if;
  end loop;
  if ma is not null then
    update public.accounts set person_id = null where id = ma;
    update public.accounts set person_id = p_keep where id = ma;
  end if;
  update public.people set
      title_id = case when k.title_id is null then m.title_id else k.title_id end,
      title_specify = case when k.title_id is null then m.title_specify else k.title_specify end,
      area_id = coalesce(k.area_id, m.area_id),
      voice_part_id = coalesce(k.voice_part_id, m.voice_part_id),
      district_group_id = coalesce(k.district_group_id, m.district_group_id),
      congregation_group_id = coalesce(k.congregation_group_id, m.congregation_group_id),
      contact = coalesce(k.contact, m.contact),
      updated_at = now()
   where id = p_keep;
  update public.people set archived = true, merged_into = p_keep, updated_at = now() where id = p_merge;
  perform public.log_action('person.merge', 'person', p_keep::text,
    jsonb_build_object('kept', k.full_name, 'merged', m.full_name, 'merged_id', p_merge));
end $$;

-- Pairs that may be the same person: the same phone number, or very similar names. Admins only.
create or replace function public.people_duplicates() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare res jsonb;
begin
  perform public.need_role(array['admin']);
  perform set_config('pg_trgm.similarity_threshold', '0.7', true);
  with cand as (
    select a.id as a_id, b.id as b_id,
           (a.contact is not null and a.contact = b.contact) as same_contact,
           similarity(a.full_name, b.full_name) as sim
      from public.people a
      join public.people b on a.id < b.id
       and ((a.contact is not null and a.contact = b.contact) or a.full_name % b.full_name)
     where not a.archived and not b.archived and a.merged_into is null and b.merged_into is null
       and not exists (select 1 from public.people_not_duplicates d where d.a = a.id and d.b = b.id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'a', public.person_snapshot(c.a_id) || jsonb_build_object('has_account', exists (select 1 from public.accounts x where x.person_id = c.a_id)),
           'b', public.person_snapshot(c.b_id) || jsonb_build_object('has_account', exists (select 1 from public.accounts x where x.person_id = c.b_id)),
           'same_contact', c.same_contact, 'similarity', round(c.sim::numeric, 2))
         order by c.same_contact desc, c.sim desc), '[]'::jsonb)
    into res
    from (select * from cand order by same_contact desc, sim desc limit 300) c;
  return res;
end $$;

create or replace function public.dismiss_duplicate(p_a uuid, p_b uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public.need_role(array['admin']);
  if p_a = p_b then raise exception 'Choose two different people.'; end if;
  insert into public.people_not_duplicates (a, b) values (least(p_a, p_b), greatest(p_a, p_b)) on conflict do nothing;
  perform public.log_action('person.not_duplicate', 'person', p_a::text, jsonb_build_object('other_id', p_b));
end $$;

-- Exports: also tracker events and lists
create or replace function public.log_export(p_scope text, p_target uuid, p_format text, p_details jsonb default '{}'::jsonb)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r text; ok boolean; title text;
begin
  r := public.need_role(array['admin', 'reviewer', 'manager', 'list_manager']);
  if p_scope not in ('list', 'event', 'signup', 'tracker_event', 'tracker_list') then raise exception 'Unknown export scope.'; end if;
  if p_scope = 'signup' and r not in ('admin', 'manager') then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  if p_scope in ('list', 'event') and r = 'list_manager' then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  if r <> 'admin' then
    ok := case when p_scope = 'list' then public.can_review_list(p_target)
                when p_scope = 'signup' then public.signup_access(p_target)
                when p_scope = 'tracker_list' then public.tracker_list_access(p_target)
                when p_scope = 'tracker_event' then public.tracker_event_access(p_target)
                else public.can_review_event(p_target) end;
    if not ok then raise exception 'You do not have access to that.' using errcode = '42501'; end if;
  end if;
  if p_scope = 'list' then
    select l.title into title from public.lists l where l.id = p_target;
  elsif p_scope = 'signup' then
    select l.title into title from public.signup_lists l where l.id = p_target;
  elsif p_scope = 'tracker_list' then
    select l.title into title from public.tracker_lists l where l.id = p_target;
  elsif p_scope = 'tracker_event' then
    select e.name into title from public.tracker_events e where e.id = p_target;
  else
    select e.name into title from public.events e where e.id = p_target;
  end if;
  perform public.log_action('export', p_scope, p_target::text,
    coalesce(p_details, '{}'::jsonb) || jsonb_build_object('format', p_format, 'name', title));
end $$;

-- 11. Tracker events and lists -----------------------------------------------------------
create or replace function public.tracker_create_event(p_name text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare eid uuid;
begin
  perform public.need_role(array['admin']);
  if char_length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'Please enter an event name.'; end if;
  insert into public.tracker_events (name, created_by) values (btrim(p_name), auth.uid()) returning id into eid;
  perform public.log_action('tracker.event.create', 'tracker_event', eid::text, jsonb_build_object('name', btrim(p_name)));
  return eid;
end $$;

create or replace function public.tracker_rename_event(p_id uuid, p_name text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare e public.tracker_events%rowtype;
begin
  perform public.need_role(array['admin']);
  if char_length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'Please enter an event name.'; end if;
  select * into e from public.tracker_events where id = p_id;
  if not found then raise exception 'Event not found.'; end if;
  update public.tracker_events set name = btrim(p_name) where id = p_id;
  perform public.log_action('tracker.event.rename', 'tracker_event', p_id::text, jsonb_build_object('from', e.name, 'to', btrim(p_name)));
end $$;

create or replace function public.tracker_set_archived(p_id uuid, p_archived boolean) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare e public.tracker_events%rowtype;
begin
  perform public.need_role(array['admin']);
  select * into e from public.tracker_events where id = p_id;
  if not found then raise exception 'Event not found.'; end if;
  update public.tracker_events set archived_at = case when p_archived then now() else null end where id = p_id;
  perform public.log_action(case when p_archived then 'tracker.event.archive' else 'tracker.event.unarchive' end,
    'tracker_event', p_id::text, jsonb_build_object('name', e.name));
end $$;

create or replace function public.tracker_delete_event(p_id uuid, p_confirm text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare e public.tracker_events%rowtype; nl int; nm int;
begin
  perform public.need_role(array['admin']);
  select * into e from public.tracker_events where id = p_id;
  if not found then raise exception 'Event not found.'; end if;
  if e.archived_at is null then raise exception 'Archive the event first, then delete it.'; end if;
  if btrim(coalesce(p_confirm, '')) <> e.name then raise exception 'Type the event name exactly to confirm.'; end if;
  select count(*) into nl from public.tracker_lists where event_id = p_id;
  select count(*) into nm from public.tracker_marks where list_id in (select id from public.tracker_lists where event_id = p_id);
  delete from public.tracker_events where id = p_id;
  perform public.log_action('tracker.event.delete', 'tracker_event', p_id::text,
    jsonb_build_object('name', e.name, 'lists', nl, 'ticks', nm));
end $$;

create or replace function public.tracker_save_list(p_id uuid, p_event uuid, p_title text, p_expected int) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare lid uuid; ev uuid; t text := btrim(coalesce(p_title, '')); arch timestamptz;
begin
  perform public.need_role(array['admin', 'manager']);
  if char_length(t) < 2 then raise exception 'Please enter a list name.'; end if;
  if p_expected is not null and p_expected < 0 then raise exception 'Expected people cannot be negative.'; end if;
  if p_id is null then ev := p_event; else select event_id into ev from public.tracker_lists where id = p_id; end if;
  if ev is null or not exists (select 1 from public.tracker_events where id = ev) then raise exception 'Event not found.'; end if;
  if not public.tracker_can_edit_event(ev) then raise exception 'You do not have permission to do that.' using errcode = '42501'; end if;
  select archived_at into arch from public.tracker_events where id = ev;
  if arch is not null then raise exception 'This event is archived. Restore it to make changes.'; end if;
  if p_id is null then
    insert into public.tracker_lists (event_id, title, expected, created_by) values (ev, t, p_expected, auth.uid()) returning id into lid;
    perform public.log_action('tracker.list.create', 'tracker_list', lid::text, jsonb_build_object('title', t, 'event_id', ev));
  else
    update public.tracker_lists set title = t, expected = p_expected where id = p_id;
    lid := p_id;
    perform public.log_action('tracker.list.edit', 'tracker_list', lid::text, jsonb_build_object('title', t, 'event_id', ev));
  end if;
  return lid;
end $$;

create or replace function public.tracker_delete_list(p_id uuid, p_confirm text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare l public.tracker_lists%rowtype; np int; nm int;
begin
  perform public.need_role(array['admin', 'manager']);
  select * into l from public.tracker_lists where id = p_id;
  if not found then raise exception 'List not found.'; end if;
  if not public.tracker_can_edit_event(l.event_id) then raise exception 'You do not have permission to do that.' using errcode = '42501'; end if;
  if btrim(coalesce(p_confirm, '')) <> l.title then raise exception 'Type the list name exactly to confirm.'; end if;
  select count(*) into np from public.tracker_entries where list_id = p_id;
  select count(*) into nm from public.tracker_marks where list_id = p_id;
  delete from public.tracker_lists where id = p_id;
  perform public.log_action('tracker.list.delete', 'tracker_list', p_id::text,
    jsonb_build_object('title', l.title, 'people', np, 'ticks', nm));
end $$;

-- One event with the lists the caller may see
create or replace function public._tracker_event_json(p_event uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', e.id, 'name', e.name, 'archived_at', e.archived_at, 'created_at', e.created_at,
    'can_edit', public.tracker_can_edit_event(e.id),
    'lists', coalesce((
       select jsonb_agg(jsonb_build_object(
         'id', l.id, 'title', l.title, 'expected', l.expected,
         'people', (select count(*) from public.tracker_entries x where x.list_id = l.id and not x.removed),
         'dates', (select count(*) from public.tracker_dates d where d.list_id = l.id and d.removed_at is null),
         'last_date', (select max(d.on_date) from public.tracker_dates d where d.list_id = l.id and d.removed_at is null),
         'present_last', (select count(*) from public.tracker_marks m join public.tracker_entries x on x.id = m.entry_id
                           where not x.removed
                             and m.date_id = (select d.id from public.tracker_dates d
                                               where d.list_id = l.id and d.removed_at is null order by d.on_date desc limit 1))
       ) order by l.created_at, l.title)
         from public.tracker_lists l
        where l.event_id = e.id and public.tracker_list_access(l.id)), '[]'::jsonb))
  from public.tracker_events e where e.id = p_event
$$;

create or replace function public.tracker_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r text := public.app_role();
begin
  if r is null or r = 'member' then raise exception 'You do not have permission to do that.' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(public._tracker_event_json(e.id) order by e.created_at desc)
      from public.tracker_events e
     where public.tracker_event_access(e.id) and (r = 'admin' or e.archived_at is null)), '[]'::jsonb);
end $$;

create or replace function public.tracker_event_get(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if public.app_role() is null or not public.tracker_event_access(p_event) then
    raise exception 'You do not have access to that.' using errcode = '42501';
  end if;
  return public._tracker_event_json(p_event);
end $$;

-- 12. Date columns ----------------------------------------------------------------------------
create or replace function public.tracker_add_date(p_list uuid, p_date date, p_title text, p_all boolean default false) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare l public.tracker_lists%rowtype; t text := nullif(left(btrim(coalesce(p_title, '')), 60), ''); x record; n int := 0;
begin
  l := public._tracker_guard(p_list, 'manage');
  if p_date is null then raise exception 'Please choose a date.'; end if;
  for x in
    select tl.id from public.tracker_lists tl
     where (tl.id = p_list or (p_all and tl.event_id = l.event_id))
       and public.tracker_list_access(tl.id)
  loop
    insert into public.tracker_dates (list_id, on_date, title, created_by) values (x.id, p_date, t, auth.uid())
    on conflict (list_id, on_date) do update
       set removed_at = null, removed_by = null, title = coalesce(excluded.title, public.tracker_dates.title)
     where public.tracker_dates.removed_at is not null;
    if found then n := n + 1; end if;
  end loop;
  if n = 0 then raise exception 'That date is already on the list.'; end if;
  perform public.log_action('tracker.date.add', 'tracker_list', p_list::text,
    jsonb_build_object('list_title', l.title, 'date', p_date, 'title', t, 'lists', n));
  return jsonb_build_object('added', n);
end $$;

create or replace function public.tracker_update_date(p_date uuid, p_on date, p_title text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare d public.tracker_dates%rowtype; l public.tracker_lists%rowtype;
begin
  select * into d from public.tracker_dates where id = p_date;
  if not found then raise exception 'Date not found.'; end if;
  l := public._tracker_guard(d.list_id, 'manage');
  if p_on is null then raise exception 'Please choose a date.'; end if;
  if exists (select 1 from public.tracker_dates where list_id = d.list_id and on_date = p_on and id <> p_date) then
    raise exception 'That date is already on the list.';
  end if;
  update public.tracker_dates set on_date = p_on, title = nullif(left(btrim(coalesce(p_title, '')), 60), '') where id = p_date;
  perform public.log_action('tracker.date.edit', 'tracker_list', d.list_id::text,
    jsonb_build_object('list_title', l.title, 'from', d.on_date, 'to', p_on));
end $$;

create or replace function public.tracker_remove_date(p_date uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare d public.tracker_dates%rowtype; l public.tracker_lists%rowtype;
begin
  select * into d from public.tracker_dates where id = p_date;
  if not found then raise exception 'Date not found.'; end if;
  l := public._tracker_guard(d.list_id, 'manage');
  update public.tracker_dates set removed_at = now(), removed_by = auth.uid() where id = p_date and removed_at is null;
  perform public.log_action('tracker.date.remove', 'tracker_list', d.list_id::text,
    jsonb_build_object('list_title', l.title, 'date', d.on_date));
end $$;

create or replace function public.tracker_restore_date(p_date uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare d public.tracker_dates%rowtype; l public.tracker_lists%rowtype;
begin
  select * into d from public.tracker_dates where id = p_date;
  if not found then raise exception 'Date not found.'; end if;
  l := public._tracker_guard(d.list_id, 'manage');
  update public.tracker_dates set removed_at = null, removed_by = null where id = p_date;
  perform public.log_action('tracker.date.restore', 'tracker_list', d.list_id::text,
    jsonb_build_object('list_title', l.title, 'date', d.on_date));
end $$;

-- 13. The grid ------------------------------------------------------------------------------------
create or replace function public.tracker_grid(p_list uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r text := public.app_role(); l record; can_manage boolean; can_mark boolean; see_contact boolean; res jsonb;
begin
  if r is null or not public.tracker_list_access(p_list) then
    raise exception 'You do not have access to that.' using errcode = '42501';
  end if;
  select tl.id, tl.title, tl.expected, tl.event_id, te.name as event_name, te.archived_at
    into l from public.tracker_lists tl join public.tracker_events te on te.id = tl.event_id where tl.id = p_list;
  if not found then raise exception 'List not found.'; end if;
  can_manage := r in ('admin', 'manager', 'list_manager');
  can_mark := can_manage or r = 'registrar';
  see_contact := can_manage;
  select jsonb_build_object(
    'list', jsonb_build_object('id', l.id, 'title', l.title, 'expected', l.expected,
                               'event_id', l.event_id, 'event_name', l.event_name, 'archived', l.archived_at is not null),
    'perms', jsonb_build_object('mark', can_mark and l.archived_at is null, 'manage', can_manage and l.archived_at is null,
                                'contact', see_contact),
    'dates', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'on_date', d.on_date, 'title', d.title,
                                                          'removed', d.removed_at is not null) order by d.on_date)
                         from public.tracker_dates d
                        where d.list_id = p_list and (can_manage or d.removed_at is null)), '[]'::jsonb),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
              'entry_id', e.id, 'person_id', p.id, 'name', p.full_name,
              'title_id', p.title_id, 'title', t.name, 'title_specify', p.title_specify,
              'contact', case when see_contact then p.contact end,
              'voice', v.name, 'area', a.name, 'district', dg.name, 'congregation', cg.name,
              'removed', e.removed,
              'marks', (select coalesce(jsonb_agg(m.date_id), '[]'::jsonb) from public.tracker_marks m where m.entry_id = e.id))
              order by p.full_name, e.added_at)
         from public.tracker_entries e
         join public.people p on p.id = e.person_id
         left join public.titles t on t.id = p.title_id
         left join public.voice_parts v on v.id = p.voice_part_id
         left join public.areas a on a.id = p.area_id
         left join public.district_groups dg on dg.id = p.district_group_id
         left join public.congregation_groups cg on cg.id = p.congregation_group_id
        where e.list_id = p_list and (can_manage or not e.removed)), '[]'::jsonb)
  ) into res;
  return res;
end $$;

-- A tick, or taking it away again
create or replace function public.tracker_set_mark(p_entry uuid, p_date uuid, p_on boolean, p_at timestamptz default null) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare e public.tracker_entries%rowtype; d public.tracker_dates%rowtype; who text;
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
  else
    delete from public.tracker_marks where entry_id = e.id and date_id = d.id;
  end if;
end $$;

-- 14. Adding people to a list -------------------------------------------------------------------
create or replace function public._tracker_card(p_person uuid, p_list uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.full_name, 'title', t.name, 'title_specify', p.title_specify,
    'voice', v.name, 'area', a.name, 'district', dg.name, 'congregation', cg.name,
    'entry_id', (select e.id from public.tracker_entries e where e.list_id = p_list and e.person_id = p.id),
    'in_list', exists (select 1 from public.tracker_entries e where e.list_id = p_list and e.person_id = p.id and not e.removed),
    'was_removed', exists (select 1 from public.tracker_entries e where e.list_id = p_list and e.person_id = p.id and e.removed))
  from public.people p
  left join public.titles t on t.id = p.title_id
  left join public.voice_parts v on v.id = p.voice_part_id
  left join public.areas a on a.id = p.area_id
  left join public.district_groups dg on dg.id = p.district_group_id
  left join public.congregation_groups cg on cg.id = p.congregation_group_id
  where p.id = p_person
$$;

create or replace function public.tracker_search_people(p_list uuid, p_q text) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare q text := left(btrim(coalesce(p_q, '')), 60); res jsonb;
begin
  perform public._tracker_guard(p_list, 'mark');
  if char_length(q) < 2 then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(public._tracker_card(x.id, p_list) order by x.score desc, x.full_name), '[]'::jsonb)
    into res
    from (
      select p.id, p.full_name, similarity(p.full_name, q) as score
        from public.people p
       where not p.archived and p.merged_into is null
         and (p.full_name ilike '%' || replace(replace(q, '%', ''), '_', '') || '%' or similarity(p.full_name, q) >= 0.3)
       order by similarity(p.full_name, q) desc, p.full_name
       limit 12
    ) x;
  return res;
end $$;

create or replace function public._tracker_tick_many(p_entry uuid, p_list uuid, p_dates uuid[]) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare who text;
begin
  if p_dates is null or cardinality(p_dates) = 0 then return; end if;
  select coalesce(nullif(full_name, ''), email) into who from public.accounts where id = auth.uid();
  insert into public.tracker_marks (entry_id, date_id, list_id, marked_by, marked_by_name)
  select p_entry, d.id, p_list, auth.uid(), who
    from public.tracker_dates d
   where d.id = any(p_dates) and d.list_id = p_list and d.removed_at is null
  on conflict do nothing;
end $$;

-- Put someone who is already in the register on this list, with ticks for the chosen dates
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
  return jsonb_build_object('status', status, 'entry_id', eid);
end $$;

-- A brand new person: added to the register and to this list in one step
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
  return jsonb_build_object('status', 'created', 'entry_id', eid, 'person_id', pid);
end $$;

-- Title is optional and can be changed in the grid
create or replace function public.tracker_set_title(p_person uuid, p_title_id uuid, p_specify text default null) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r text := public.app_role();
begin
  if r not in ('admin', 'manager', 'list_manager', 'registrar') then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  if r <> 'admin' and not exists (select 1 from public.tracker_entries e
                                   where e.person_id = p_person and not e.removed and public.tracker_list_access(e.list_id)) then
    raise exception 'You do not have access to that.' using errcode = '42501';
  end if;
  if p_title_id is not null and not exists (select 1 from public.titles where id = p_title_id and active) then
    raise exception 'Unknown title.';
  end if;
  update public.people
     set title_id = p_title_id,
         title_specify = case when p_title_id is null then null else nullif(left(btrim(coalesce(p_specify, '')), 60), '') end,
         updated_at = now()
   where id = p_person;
end $$;

create or replace function public.tracker_remove_entry(p_entry uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare e public.tracker_entries%rowtype; l public.tracker_lists%rowtype; nm text;
begin
  select * into e from public.tracker_entries where id = p_entry;
  if not found then raise exception 'Person not found on this list.'; end if;
  l := public._tracker_guard(e.list_id, 'manage');
  if e.removed then return; end if;
  update public.tracker_entries set removed = true, removed_by = auth.uid(), removed_at = now() where id = p_entry;
  select full_name into nm from public.people where id = e.person_id;
  perform public.log_action('tracker.entry.remove', 'tracker_list', e.list_id::text,
    jsonb_build_object('list_title', l.title, 'person', nm, 'person_id', e.person_id));
end $$;

create or replace function public.tracker_restore_entry(p_entry uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare e public.tracker_entries%rowtype; l public.tracker_lists%rowtype; nm text;
begin
  select * into e from public.tracker_entries where id = p_entry;
  if not found then raise exception 'Person not found on this list.'; end if;
  l := public._tracker_guard(e.list_id, 'manage');
  if not e.removed then return; end if;
  update public.tracker_entries set removed = false, removed_by = null, removed_at = null where id = p_entry;
  select full_name into nm from public.people where id = e.person_id;
  perform public.log_action('tracker.entry.restore', 'tracker_list', e.list_id::text,
    jsonb_build_object('list_title', l.title, 'person', nm, 'person_id', e.person_id));
end $$;

-- 15. Summary and analytics ------------------------------------------------------------------------
-- One call for a whole tracker event (p_list null) or one list. p_date null counts everyone ticked on any
-- date; a date counts only the people ticked on that date. Figures use the people's current details.
create or replace function public.tracker_analytics(p_event uuid, p_list uuid default null, p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare ev public.tracker_events%rowtype; res jsonb;
begin
  if public.app_role() is null or not public.tracker_event_access(p_event) then
    raise exception 'You do not have access to that.' using errcode = '42501';
  end if;
  select * into ev from public.tracker_events where id = p_event;
  if p_list is not null and not exists (select 1 from public.tracker_lists where id = p_list and event_id = p_event) then
    raise exception 'List not found.';
  end if;
  with
    L as (select tl.* from public.tracker_lists tl
           where tl.event_id = p_event and (p_list is null or tl.id = p_list) and public.tracker_list_access(tl.id)),
    D as (select d.* from public.tracker_dates d join L on L.id = d.list_id where d.removed_at is null),
    E as (select e.* from public.tracker_entries e join L on L.id = e.list_id where not e.removed),
    M as (select m.entry_id, m.date_id, m.marked_at, D.on_date, E.list_id
            from public.tracker_marks m join D on D.id = m.date_id join E on E.id = m.entry_id),
    S as (select * from M where p_date is null or on_date = p_date),
    PR as (select distinct list_id, entry_id from S),
    PP as (select PR.list_id, pe.* from PR join E on E.id = PR.entry_id join public.people pe on pe.id = E.person_id)
  select jsonb_build_object(
    'event', jsonb_build_object('id', ev.id, 'name', ev.name),
    'date', p_date,
    'lists', coalesce((select jsonb_agg(jsonb_build_object(
        'id', L.id, 'title', L.title, 'expected', L.expected,
        'people', (select count(*) from E where E.list_id = L.id),
        'present', (select count(*) from PR where PR.list_id = L.id),
        'dates', (select count(*) from D where D.list_id = L.id),
        'every_date', (select count(*) from E where E.list_id = L.id
                          and (select count(*) from D where D.list_id = L.id) > 0
                          and (select count(*) from M where M.entry_id = E.id) = (select count(*) from D where D.list_id = L.id)),
        'never', (select count(*) from E where E.list_id = L.id and not exists (select 1 from M where M.entry_id = E.id))
      ) order by L.created_at, L.title) from L), '[]'::jsonb),
    'dates', coalesce((select jsonb_agg(jsonb_build_object('on_date', x.on_date, 'title', x.title, 'lists', x.n) order by x.on_date)
                         from (select on_date, max(title) as title, count(*) as n from D group by on_date) x), '[]'::jsonb),
    'trend', coalesce((select jsonb_agg(jsonb_build_object('list_id', D.list_id, 'on_date', D.on_date,
                         'present', (select count(*) from M where M.date_id = D.id)) order by D.on_date) from D), '[]'::jsonb),
    'voices', coalesce((select jsonb_agg(jsonb_build_object('list_id', y.list_id, 'name', y.k, 'n', y.n))
                          from (select PP.list_id, coalesce(v.name, 'Not set') as k, count(*) as n
                                  from PP left join public.voice_parts v on v.id = PP.voice_part_id group by 1, 2) y), '[]'::jsonb),
    'titles', coalesce((select jsonb_agg(jsonb_build_object('name', y.k, 'n', y.n))
                          from (select coalesce(t.name, 'Not set') as k, count(*) as n
                                  from PP left join public.titles t on t.id = PP.title_id group by 1) y), '[]'::jsonb),
    'districts', coalesce((select jsonb_agg(jsonb_build_object('list_id', y.list_id, 'name', y.k, 'n', y.n))
                             from (select PP.list_id, coalesce(g.name, 'Not set') as k, count(*) as n
                                     from PP left join public.district_groups g on g.id = PP.district_group_id group by 1, 2) y), '[]'::jsonb),
    'congregations', coalesce((select jsonb_agg(jsonb_build_object('name', y.k, 'n', y.n) order by y.n desc, y.k)
                                 from (select coalesce(g.name, 'Not set') as k, count(*) as n
                                         from PP left join public.congregation_groups g on g.id = PP.congregation_group_id group by 1) y), '[]'::jsonb),
    'timeline', coalesce((select jsonb_agg(jsonb_build_object('hour', y.h, 'n', y.n) order by y.h)
                            from (select extract(hour from (S.marked_at at time zone 'Africa/Lusaka'))::int as h, count(*) as n
                                    from S group by 1) y), '[]'::jsonb)
  ) into res;
  return res;
end $$;

-- 16. Spreadsheet import --------------------------------------------------------------------------------
-- p_rows: [{name, phone, voice, area, district, congregation, title, at}]. Everything runs in one pass; when
-- p_commit is false the pass is rolled back and only the result (a preview) is returned, so the preview is
-- exactly what Import will do. p_map holds hand-made matches:
--   {"voice": {"<raw text, lower case>": "<voice id>" | "none"},
--    "district": {"<spelling>": "<district id>"}, "congregation": {"<spelling>": "<congregation id>"}}
-- People are never merged here. A phone number that already exists means the same person; a similar name
-- with a different number is created as a new person and flagged for the Possible duplicates page.
create or replace function public.tracker_import(
  p_event uuid, p_list uuid, p_rows jsonb, p_date date default null, p_date_title text default null,
  p_map jsonb default '{}'::jsonb, p_commit boolean default false
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  r text; ev uuid; arch timestamptz; ltitle text;
  jr jsonb; i int := 0;
  nm text; ph text; rv text; ra text; rd text; rc text; rt text; nd text; nc text; mk text;
  vid uuid; aid uuid; dgid uuid; cgid uuid; tid uuid; pid uuid; lid uuid; eid uuid; did uuid; mat uuid; gtmp uuid;
  st text; msg text; at_ts timestamptz; pe public.tracker_entries%rowtype; ins boolean;
  out_rows jsonb := '[]'::jsonb; per_list jsonb := '{}'::jsonb; poss jsonb := '[]'::jsonb; sims jsonb;
  unm text[] := '{}'; new_d jsonb := '[]'::jsonb; new_c jsonb := '[]'::jsonb;
  c_new int := 0; c_exist int := 0; c_added int := 0; c_already int := 0; c_skip int := 0; c_tick int := 0; c_badphone int := 0; tick_n int;
  before_d uuid[]; before_c uuid[];
begin
  r := public.need_role(array['admin', 'manager', 'list_manager']);
  perform public.rate_check('tracker_import', 20, 60);
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'Nothing to import.'; end if;
  if jsonb_array_length(p_rows) > 2000 then raise exception 'Import up to 2000 people at a time.'; end if;
  if p_list is not null then
    perform public._tracker_guard(p_list, 'manage');
    select event_id into ev from public.tracker_lists where id = p_list;
  else
    ev := p_event;
    if ev is null or not exists (select 1 from public.tracker_events where id = ev) then raise exception 'Choose an event or a list.'; end if;
    if not public.tracker_can_edit_event(ev) then
      raise exception 'Only an admin or the event manager can import into a whole event.' using errcode = '42501';
    end if;
    select archived_at into arch from public.tracker_events where id = ev;
    if arch is not null then raise exception 'This event is archived. Restore it to make changes.'; end if;
  end if;

  before_d := array(select id from public.district_groups);
  before_c := array(select id from public.congregation_groups);

  begin
    for jr in select * from jsonb_array_elements(p_rows) loop
      i := i + 1; st := null; msg := null; pid := null; lid := null; mat := null;
      nm := public._cap_words(jr->>'name');
      if char_length(nm) < 2 then
        c_skip := c_skip + 1;
        out_rows := out_rows || jsonb_build_object('idx', i, 'status', 'invalid', 'message', 'No name.');
        continue;
      end if;

      -- phone
      ph := null;
      begin ph := public.normalize_contact(jr->>'phone'); exception when others then ph := null; c_badphone := c_badphone + 1; end;

      -- voice: known spelling, or a hand-made match
      rv := lower(btrim(coalesce(jr->>'voice', '')));
      vid := null;
      if rv <> '' then
        vid := public.resolve_voice(rv);
        if vid is null then
          mk := p_map->'voice'->>rv;
          if mk is not null and mk <> 'none' and exists (select 1 from public.voice_parts where id::text = mk) then
            vid := mk::uuid;
            insert into public.voice_aliases (alias, voice_part_id) values (left(regexp_replace(rv, '[^a-z0-9]+', '', 'g'), 60), vid)
              on conflict (alias) do update set voice_part_id = excluded.voice_part_id;
          elsif mk is null and not (rv = any(unm)) then
            unm := array_append(unm, rv);
          end if;
        end if;
      end if;

      -- area (the name of the area the person belongs to)
      aid := public.resolve_area(jr->>'area');

      -- district and congregation: matched to an existing one, or kept as a new one for review
      rd := btrim(coalesce(jr->>'district', ''));
      dgid := null;
      if public.normalize_district(rd) <> '' and char_length(public.normalize_district(rd)) >= 2 then
        nd := left(public.normalize_district(rd), 80);
        mk := p_map->'district'->>nd;
        if mk is not null and exists (select 1 from public.district_groups where id::text = mk) then
          dgid := mk::uuid;
          insert into public.district_variants (group_id, variant) values (dgid, nd) on conflict (variant) do nothing;
        else
          dgid := public.resolve_district(rd);
        end if;
      end if;
      rc := btrim(coalesce(jr->>'congregation', ''));
      cgid := null;
      if char_length(public.normalize_congregation(rc)) >= 2 then
        nc := left(public.normalize_congregation(rc), 80);
        mk := p_map->'congregation'->>nc;
        if mk is not null and exists (select 1 from public.congregation_groups where id::text = mk) then
          cgid := mk::uuid;
          insert into public.congregation_variants (group_id, variant) values (cgid, nc) on conflict (variant) do nothing;
        else
          cgid := public.resolve_congregation(rc);
        end if;
      end if;

      -- title (optional)
      rt := lower(btrim(coalesce(jr->>'title', '')));
      tid := null;
      if rt <> '' then select id into tid from public.titles where active and lower(name) = rt; end if;

      -- which list does this person go to?
      if p_list is not null then
        lid := p_list;
      else
        select tl.id into lid from public.tracker_lists tl
         where tl.event_id = ev and aid is not null
           and position(' ' || lower((select name from public.areas where id = aid)) || ' '
                        in ' ' || btrim(regexp_replace(lower(tl.title), '[^a-z]+', ' ', 'g')) || ' ') > 0
         order by tl.created_at limit 1;
      end if;
      if lid is null then
        c_skip := c_skip + 1;
        out_rows := out_rows || jsonb_build_object('idx', i, 'name', nm, 'status', 'no_list',
          'message', 'No list in this event matches the area' || coalesce(' "' || nullif(btrim(coalesce(jr->>'area', '')), '') || '"', '') || '.');
        continue;
      end if;

      -- the person: the same phone number means the same person
      if ph is not null then
        select id into mat from public.people where contact = ph and not archived and merged_into is null order by created_at limit 1;
      end if;
      if mat is null then
        select id into mat from public.people
         where not archived and merged_into is null and contact is null and lower(full_name) = lower(nm) order by created_at limit 1;
      end if;
      if mat is not null then
        pid := mat; c_exist := c_exist + 1; st := 'existing';
        update public.people set
            voice_part_id = coalesce(voice_part_id, vid), area_id = coalesce(area_id, aid),
            district_group_id = coalesce(district_group_id, dgid), congregation_group_id = coalesce(congregation_group_id, cgid),
            contact = coalesce(contact, ph), title_id = coalesce(title_id, tid), updated_at = now()
         where id = pid;
      else
        insert into public.people (full_name, title_id, area_id, voice_part_id, district_group_id, congregation_group_id, contact, created_by)
        values (nm, tid, aid, vid, dgid, cgid, ph, auth.uid()) returning id into pid;
        c_new := c_new + 1; st := 'new';
        select coalesce(jsonb_agg(jsonb_build_object('name', p.full_name, 'contact', p.contact)), '[]'::jsonb) into sims
          from (select p2.full_name, p2.contact from public.people p2
                 where p2.id <> pid and not p2.archived and p2.merged_into is null and similarity(p2.full_name, nm) >= 0.8
                 order by similarity(p2.full_name, nm) desc limit 3) p;
        if jsonb_array_length(sims) > 0 then
          poss := poss || jsonb_build_object('idx', i, 'name', nm, 'contact', ph, 'matches', sims);
        end if;
      end if;

      -- the list
      select * into pe from public.tracker_entries where list_id = lid and person_id = pid;
      if found then
        if pe.removed then
          update public.tracker_entries set removed = false, removed_by = null, removed_at = null where id = pe.id;
          c_added := c_added + 1; msg := 'Was removed from the list; put back.';
        else
          c_already := c_already + 1; st := 'already'; msg := 'Already on the list.';
        end if;
        eid := pe.id;
      else
        insert into public.tracker_entries (list_id, person_id, added_by) values (lid, pid, auth.uid()) returning id into eid;
        c_added := c_added + 1;
      end if;
      per_list := jsonb_set(per_list, array[lid::text], to_jsonb(coalesce((per_list->>lid::text)::int, 0) + 1), true);

      -- the tick for the chosen date
      if p_date is not null then
        select id into did from public.tracker_dates where list_id = lid and on_date = p_date;
        if did is null then
          insert into public.tracker_dates (list_id, on_date, title, created_by)
          values (lid, p_date, nullif(left(btrim(coalesce(p_date_title, '')), 60), ''), auth.uid()) returning id into did;
        else
          update public.tracker_dates set removed_at = null, removed_by = null where id = did and removed_at is not null;
        end if;
        at_ts := null;
        begin at_ts := (jr->>'at')::timestamptz; exception when others then at_ts := null; end;
        if at_ts is null or at_ts > now() then at_ts := now(); end if;
        insert into public.tracker_marks (entry_id, date_id, list_id, marked_by, marked_by_name, marked_at)
        values (eid, did, lid, auth.uid(), (select coalesce(nullif(full_name, ''), email) from public.accounts where id = auth.uid()), at_ts)
        on conflict do nothing;
        get diagnostics tick_n = row_count;
        c_tick := c_tick + tick_n;
      end if;
      out_rows := out_rows || jsonb_build_object('idx', i, 'name', nm, 'status', st, 'message', msg, 'list_id', lid);
    end loop;

    -- new districts and congregations (with the closest existing one, as a suggestion)
    select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name,
             'variant', (select min(v.variant) from public.district_variants v where v.group_id = g.id),
             'people', (select count(*) from public.people p where p.district_group_id = g.id),
             'suggest', (select jsonb_build_object('id', g2.id, 'name', g2.name)
                           from public.district_groups g2 join public.district_variants v2 on v2.group_id = g2.id
                          where g2.id = any(before_d)
                          order by similarity(v2.variant, g.name) desc limit 1)) order by g.name), '[]'::jsonb)
      into new_d from public.district_groups g where g.id <> all(before_d);
    select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name,
             'variant', (select min(v.variant) from public.congregation_variants v where v.group_id = g.id),
             'people', (select count(*) from public.people p where p.congregation_group_id = g.id),
             'suggest', (select jsonb_build_object('id', g2.id, 'name', g2.name)
                           from public.congregation_groups g2 join public.congregation_variants v2 on v2.group_id = g2.id
                          where g2.id = any(before_c)
                          order by similarity(v2.variant, g.name) desc limit 1)) order by g.name), '[]'::jsonb)
      into new_c from public.congregation_groups g where g.id <> all(before_c);

    if p_commit then
      if cardinality(unm) > 0 then
        raise exception 'Some voice spellings still need to be matched: %', array_to_string(unm, ', ');
      end if;
      perform public.log_action('tracker.import', 'tracker_event', ev::text,
        jsonb_build_object('rows', i, 'new_people', c_new, 'existing_people', c_exist, 'added_to_list', c_added,
                           'already_on_list', c_already, 'skipped', c_skip, 'date', p_date,
                           'list_id', p_list));
    else
      raise exception 'preview' using errcode = 'P0900';
    end if;
  exception when sqlstate 'P0900' then
    null;     -- preview: everything above is undone; the result below is still returned
  end;

  return jsonb_build_object(
    'committed', p_commit,
    'rows', out_rows,
    'counts', jsonb_build_object('rows', i, 'new_people', c_new, 'existing_people', c_exist, 'added_to_list', c_added,
                                 'already_on_list', c_already, 'skipped', c_skip, 'bad_phone', c_badphone, 'ticked', c_tick),
    'per_list', per_list,
    'unmapped_voices', to_jsonb(unm),
    'new_districts', new_d,
    'new_congregations', new_c,
    'possible_duplicates', poss);
end $$;

-- 17. Who may call what -----------------------------------------------------------------------------------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = any (array[
         'tracker_event_access', 'tracker_list_access', 'tracker_can_edit_event',
         'tracker_create_event', 'tracker_rename_event', 'tracker_set_archived', 'tracker_delete_event',
         'tracker_save_list', 'tracker_delete_list', 'tracker_overview', 'tracker_event_get',
         'tracker_add_date', 'tracker_update_date', 'tracker_remove_date', 'tracker_restore_date',
         'tracker_grid', 'tracker_set_mark', 'tracker_search_people', 'tracker_add_entry', 'tracker_create_person',
         'tracker_set_title', 'tracker_remove_entry', 'tracker_restore_entry', 'tracker_analytics', 'tracker_import',
         'tracker_team', 'grant_tracker_access',
         'suggest_congregations', 'congregation_overview', 'rename_congregation', 'merge_congregations', 'delete_congregation',
         'people_duplicates', 'dismiss_duplicate',
         'create_person', 'update_person', 'delete_person', 'merge_people', 'change_role', 'revoke_grant', 'log_export'])
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

-- the Supabase function service (invites) needs the new tables too
grant usage on schema public to service_role;
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
