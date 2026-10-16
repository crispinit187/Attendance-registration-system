-- ============================================================================
-- Attendance Registration System - step 1 of 3: tables
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
-- ============================================================================

create schema if not exists extensions;
create extension if not exists pg_trgm      with schema extensions;
create extension if not exists fuzzystrmatch with schema extensions;
create extension if not exists pgcrypto     with schema extensions;

-- ---------------------------------------------------------------------------
-- Lookups (managed by admins)
-- ---------------------------------------------------------------------------
create table public.areas (
  id     uuid primary key default gen_random_uuid(),
  name   text not null unique,
  sort   int  not null default 0,
  active boolean not null default true
);

create table public.titles (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  needs_specify boolean not null default false,
  sort          int  not null default 0,
  active        boolean not null default true
);

create table public.voice_parts (
  id     uuid primary key default gen_random_uuid(),
  name   text not null unique,
  sort   int  not null default 0,
  active boolean not null default true
);

-- District groups: one canonical name plus every spelling that was matched to it.
create table public.district_groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);
create unique index district_groups_name_key on public.district_groups (lower(name));

create table public.district_variants (
  id       uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.district_groups(id) on delete cascade,
  variant  text not null unique            -- normalised spelling
);
create index district_variants_group on public.district_variants (group_id);
create index district_variants_trgm on public.district_variants using gin (variant extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- People (who attends) and accounts (who can log in)
-- A person may have no account. An account may be linked to one person.
-- ---------------------------------------------------------------------------
create table public.people (
  id                uuid primary key default gen_random_uuid(),
  title_id          uuid references public.titles(id),
  title_specify     text,
  full_name         text not null check (char_length(btrim(full_name)) >= 2),
  area_id           uuid references public.areas(id),
  district_group_id uuid references public.district_groups(id),
  voice_part_id     uuid references public.voice_parts(id),
  contact           text check (contact is null or contact ~ '^\+260 [0-9]{3} [0-9]{3} [0-9]{3}$'),
  created_by        uuid references auth.users(id) on delete set null,
  archived          boolean not null default false,
  merged_into       uuid references public.people(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index people_name_trgm on public.people using gin (full_name extensions.gin_trgm_ops);
create index people_created_by on public.people (created_by);

create table public.accounts (
  id                uuid primary key references auth.users(id) on delete cascade,
  email             text,
  full_name         text,
  role              text not null default 'member'
                    check (role in ('admin','reviewer','registrar','member')),
  person_id         uuid unique references public.people(id) on delete set null,
  must_set_password boolean not null default false,
  disabled          boolean not null default false,
  created_by        uuid,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Events, lists and their secrets
-- ---------------------------------------------------------------------------
create table public.events (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) >= 2),
  created_by uuid,
  created_at timestamptz not null default now(),
  archived_at timestamptz                      -- set when the event is archived (hidden, restorable)
);

create table public.lists (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references public.events(id) on delete cascade,
  title            text not null check (char_length(btrim(title)) >= 2),
  status           text not null default 'draft'
                   check (status in ('draft','open','closed','archived')),
  allowed_area_ids uuid[] not null default '{}',       -- empty = every area
  location_check   boolean not null default false,
  venue_lat        double precision check (venue_lat between -90 and 90),
  venue_lng        double precision check (venue_lng between -180 and 180),
  radius_m         int not null default 200 check (radius_m between 20 and 5000),
  rotating_qr      boolean not null default false,
  rotation_seconds int not null default 30 check (rotation_seconds between 10 and 300),
  opened_at        timestamptz,
  closed_at        timestamptz,
  archived_at      timestamptz,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  check (not location_check or (venue_lat is not null and venue_lng is not null))
);
create index lists_event on public.lists (event_id);

-- THE ONE-OPEN-LIST RULE, enforced by the database itself:
-- at most one row in the whole table can have status = 'open'.
create unique index one_open_list on public.lists ((status)) where status = 'open';

create table public.list_secrets (
  list_id         uuid primary key references public.lists(id) on delete cascade,
  qr_token        text not null default encode(extensions.gen_random_bytes(16), 'hex'),
  rotation_secret text not null default encode(extensions.gen_random_bytes(24), 'hex')
);

-- ---------------------------------------------------------------------------
-- Attendance. Each row keeps a snapshot of the person's details at that
-- moment, so later profile edits never change history.
-- ---------------------------------------------------------------------------
create table public.attendance (
  id             uuid primary key default gen_random_uuid(),
  list_id        uuid not null references public.lists(id) on delete cascade,
  person_id      uuid not null references public.people(id),
  method         text not null check (method in ('self','registrar','admin')),
  marked_by      uuid references auth.users(id) on delete set null,
  marked_by_name text,                       -- who marked, kept as text so it survives account changes
  marked_at      timestamptz not null default now(),
  snapshot       jsonb not null,
  removed        boolean not null default false,
  removed_by     uuid references auth.users(id) on delete set null,
  removed_at     timestamptz,
  removed_reason text,
  unique (list_id, person_id)
);
create index attendance_list on public.attendance (list_id);
create index attendance_person on public.attendance (person_id);

-- ---------------------------------------------------------------------------
-- Reviewer access: a whole event (every list in it, now and later) or one list
-- ---------------------------------------------------------------------------
create table public.reviewer_grants (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  event_id   uuid references public.events(id) on delete cascade,
  list_id    uuid references public.lists(id) on delete cascade,
  created_by uuid,
  created_at timestamptz not null default now(),
  check ((event_id is null) <> (list_id is null))
);
create unique index reviewer_grants_event_key on public.reviewer_grants (account_id, event_id) where event_id is not null;
create unique index reviewer_grants_list_key  on public.reviewer_grants (account_id, list_id)  where list_id  is not null;

-- ---------------------------------------------------------------------------
-- Audit log: append-only. Nobody can change or delete rows through the app.
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor_id    uuid,
  actor_name  text,
  action      text not null,
  target_type text,
  target_id   text,
  details     jsonb not null default '{}'::jsonb
);
create index audit_log_at on public.audit_log (at desc);

create function public.audit_log_is_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'The audit log cannot be changed or deleted.';
end $$;

create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function public.audit_log_is_append_only();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function public.audit_log_is_append_only();

-- ---------------------------------------------------------------------------
-- Rate limiting events (used by the functions in step 2)
-- ---------------------------------------------------------------------------
create table public.rate_events (
  actor  uuid,
  action text not null,
  at     timestamptz not null default now()
);
create index rate_events_lookup on public.rate_events (actor, action, at desc);

-- ---------------------------------------------------------------------------
-- Sign-up lists: the public scans a QR code (or opens a shared link) and types
-- their details. No account needed. Kept apart from attendance lists and from
-- the people directory; an admin can later turn an entry into a person/account
-- or attach it to an existing person.
-- ---------------------------------------------------------------------------
create table public.signup_lists (
  id               uuid primary key default gen_random_uuid(),
  title            text not null check (char_length(btrim(title)) >= 2),
  status           text not null default 'closed' check (status in ('open','closed')),
  code             text not null unique default encode(extensions.gen_random_bytes(12), 'hex'),
  voice_part_ids   uuid[] not null default '{}',      -- voice parts offered; empty = all
  allowed_area_ids uuid[] not null default '{}',      -- empty = every area
  location_check   boolean not null default false,
  venue_lat        double precision check (venue_lat between -90 and 90),
  venue_lng        double precision check (venue_lng between -180 and 180),
  radius_m         int not null default 200 check (radius_m between 20 and 5000),
  opened_at        timestamptz,
  closed_at        timestamptz,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  check (not location_check or (venue_lat is not null and venue_lng is not null))
);
-- Only one sign-up list can be open at a time (separate from attendance lists)
create unique index one_open_signup on public.signup_lists ((status)) where status = 'open';

create table public.signup_entries (
  id                uuid primary key default gen_random_uuid(),
  list_id           uuid not null references public.signup_lists(id) on delete cascade,
  title_id          uuid references public.titles(id),
  title_specify     text,
  full_name         text not null check (char_length(btrim(full_name)) >= 2),
  name_key          text not null default '',
  area_id           uuid references public.areas(id),
  district_group_id uuid references public.district_groups(id),
  voice_part_id     uuid references public.voice_parts(id),
  contact           text check (contact is null or contact ~ '^\+260 [0-9]{3} [0-9]{3} [0-9]{3}$'),
  source            text not null check (source in ('public','staff','paste')),
  added_by          uuid references auth.users(id) on delete set null,
  added_by_name     text,
  forced            boolean not null default false,   -- added although a similar name existed
  removed           boolean not null default false,
  removed_by        uuid references auth.users(id) on delete set null,
  removed_at        timestamptz,
  removed_reason    text,
  person_id         uuid references public.people(id) on delete set null,   -- set by Create account / Merge
  linked_at         timestamptz,
  created_at        timestamptz not null default now()
);
create index signup_entries_list on public.signup_entries (list_id);
create index signup_entries_key  on public.signup_entries (list_id, name_key) where not removed;
create index signup_entries_trgm on public.signup_entries using gin (name_key extensions.gin_trgm_ops);
create index signup_entries_person on public.signup_entries (person_id);
