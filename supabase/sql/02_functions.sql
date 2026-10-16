-- ============================================================================
-- Attendance Registration System - step 2 of 3: functions (the rules)
-- Run AFTER 01_tables.sql. Paste into SQL Editor and Run.
--
-- All the business rules live here, in the database, so the website cannot
-- bypass them: roles, the one-open-list rule, location and QR checks, undo,
-- removal, archive/delete, audit logging and rate limits.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Small helpers
-- ---------------------------------------------------------------------------
create function public.app_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.accounts where id = auth.uid() and not disabled
$$;

create function public.my_person_id() returns uuid
language sql stable security definer set search_path = public as $$
  select person_id from public.accounts where id = auth.uid() and not disabled
$$;

create function public.can_review_list(p_list uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.reviewer_grants g
    join public.accounts a on a.id = g.account_id
    where g.account_id = auth.uid()
      and a.role = 'reviewer' and not a.disabled
      and (g.list_id = p_list
           or g.event_id = (select l.event_id from public.lists l where l.id = p_list))
  )
$$;

create function public.can_review_event(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.reviewer_grants g
    join public.accounts a on a.id = g.account_id
    where g.account_id = auth.uid()
      and a.role = 'reviewer' and not a.disabled
      and (g.event_id = p_event
           or g.list_id in (select l.id from public.lists l where l.event_id = p_event))
  )
$$;

create function public.need_role(p_roles text[]) returns text
language plpgsql stable security definer set search_path = public as $$
declare r text := public.app_role();
begin
  if r is null or not (r = any(p_roles)) then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  return r;
end $$;

create function public.log_action(p_action text, p_type text, p_target text, p_details jsonb default '{}'::jsonb)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare nm text;
begin
  select coalesce(nullif(full_name, ''), email) into nm from public.accounts where id = auth.uid();
  insert into public.audit_log (actor_id, actor_name, action, target_type, target_id, details)
  values (auth.uid(), nm, p_action, p_type, p_target, coalesce(p_details, '{}'::jsonb));
end $$;

-- Per-account rate limit: at most p_max calls of p_action in p_seconds.
create function public.rate_check(p_action text, p_max int, p_seconds int) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare n int;
begin
  if random() < 0.02 then
    delete from public.rate_events where at < now() - interval '1 hour';
  end if;
  select count(*) into n from public.rate_events
   where actor = auth.uid() and action = p_action
     and at > now() - make_interval(secs => p_seconds);
  if n >= p_max then
    raise exception 'Too many requests. Please wait a moment and try again.';
  end if;
  insert into public.rate_events (actor, action) values (auth.uid(), p_action);
end $$;

create function public.display_name(p_title text, p_specify text, p_name text) returns text
language sql immutable as $$
  select btrim(coalesce(p_title, '')
    || case when p_specify is not null and btrim(p_specify) <> '' then ' (' || btrim(p_specify) || ')' else '' end
    || ' ' || coalesce(p_name, ''))
$$;

create function public.distance_m(lat1 double precision, lng1 double precision,
                                  lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

-- Rotating QR code for a time window
create function public.rot_code(p_secret text, p_window bigint) returns text
language sql immutable set search_path = public, extensions as $$
  select substr(encode(extensions.hmac(p_window::text, p_secret, 'sha256'), 'hex'), 1, 16)
$$;

-- Zambian contact number -> "+260 9XX XXX XXX"
create function public.normalize_contact(p text) returns text
language plpgsql immutable as $$
declare d text;
begin
  if p is null or btrim(p) = '' then return null; end if;
  d := regexp_replace(p, '[^0-9]', '', 'g');
  if d like '260%' and length(d) = 12 then
    null;
  elsif d like '0%' and length(d) = 10 then
    d := '260' || substr(d, 2);
  elsif length(d) = 9 then
    d := '260' || d;
  else
    raise exception 'Contact must be a Zambian number like +260 9XX XXX XXX.';
  end if;
  return '+260 ' || substr(d, 4, 3) || ' ' || substr(d, 7, 3) || ' ' || substr(d, 10, 3);
end $$;

-- ---------------------------------------------------------------------------
-- District matching (typo tolerant, shared by every list)
-- ---------------------------------------------------------------------------
create function public.normalize_district(p text) returns text
language sql immutable as $$
  select btrim(regexp_replace(
           regexp_replace(
             regexp_replace(lower(coalesce(p, '')), '\m(districts?|the)\M', ' ', 'g'),
             '[^a-z0-9 ]', ' ', 'g'),
           '\s+', ' ', 'g'))
$$;

-- Digits and compass words must agree, so "Lusaka East" never merges with "Lusaka West"
-- and "Zone 1" never merges with "Zone 2".
create function public.district_tokens(n text) returns text
language sql immutable as $$
  select regexp_replace(n, '[^0-9]', '', 'g') || '|' ||
         coalesce((select string_agg(m[1], ',' order by m[1])
                   from regexp_matches(n, '(east|west|north|south)', 'g') as m), '')
$$;

create function public.resolve_district(p_raw text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare n text; gid uuid; tol int;
begin
  n := left(public.normalize_district(p_raw), 80);
  if char_length(n) < 2 then
    raise exception 'Please enter your district.';
  end if;

  select group_id into gid from public.district_variants where variant = n;
  if gid is not null then return gid; end if;

  tol := case when char_length(n) <= 6 then 1 when char_length(n) <= 10 then 2 else 3 end;

  select v.group_id into gid
    from public.district_variants v
   where public.district_tokens(v.variant) = public.district_tokens(n)
     and (levenshtein(v.variant, n) <= tol or similarity(v.variant, n) >= 0.6)
   order by levenshtein(v.variant, n), similarity(v.variant, n) desc
   limit 1;

  if gid is null then
    insert into public.district_groups (name) values (initcap(n))
      on conflict (lower(name)) do nothing
      returning id into gid;
    if gid is null then
      select id into gid from public.district_groups where lower(name) = lower(initcap(n));
    end if;
  end if;

  insert into public.district_variants (group_id, variant) values (gid, n)
    on conflict (variant) do nothing;
  return gid;
end $$;

create function public.suggest_districts(p_q text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare n text; res jsonb;
begin
  if auth.uid() is null then raise exception 'Please sign in.'; end if;
  perform public.rate_check('suggest', 120, 60);
  n := left(public.normalize_district(p_q), 60);
  if char_length(n) < 2 then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', x.gid, 'name', x.gname) order by x.score desc, x.gname), '[]'::jsonb)
    into res
    from (
      select g.id as gid, g.name as gname,
             (select max(similarity(v.variant, n)) from public.district_variants v where v.group_id = g.id) as score
        from public.district_groups g
       where exists (
         select 1 from public.district_variants v
          where v.group_id = g.id
            and (v.variant like n || '%' or v.variant like '% ' || n || '%' or similarity(v.variant, n) >= 0.35))
       order by score desc, g.name
       limit 5
    ) x;
  return res;
end $$;

-- ---------------------------------------------------------------------------
-- People: validation helpers and snapshot
-- ---------------------------------------------------------------------------
create function public._clean_specify(p_title uuid, p_specify text) returns text
language plpgsql stable security definer set search_path = public as $$
declare t public.titles%rowtype;
begin
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

create function public._check_lookups(p_area uuid, p_voice uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.areas where id = p_area and active) then
    raise exception 'Please choose your area.';
  end if;
  if not exists (select 1 from public.voice_parts where id = p_voice and active) then
    raise exception 'Please choose your voice part.';
  end if;
end $$;

create function public.person_snapshot(p_person uuid) returns jsonb
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
    'voice_part_id', p.voice_part_id,
    'voice_part', v.name,
    'contact', p.contact)
  from public.people p
  left join public.titles t on t.id = p.title_id
  left join public.areas a on a.id = p.area_id
  left join public.district_groups g on g.id = p.district_group_id
  left join public.voice_parts v on v.id = p.voice_part_id
  where p.id = p_person
$$;

-- A short card for search results (no contact details)
create function public._person_card(p_person uuid, p_list uuid) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'id', p.id,
    'display_name', public.display_name(t.name, p.title_specify, p.full_name),
    'area', a.name,
    'district', g.name,
    'has_account', exists (select 1 from public.accounts ac where ac.person_id = p.id),
    'present', coalesce((select not at.removed from public.attendance at
                          where at.list_id = p_list and at.person_id = p.id), false),
    'was_removed', coalesce((select at.removed from public.attendance at
                          where at.list_id = p_list and at.person_id = p.id), false))
  from public.people p
  left join public.titles t on t.id = p.title_id
  left join public.areas a on a.id = p.area_id
  left join public.district_groups g on g.id = p.district_group_id
  where p.id = p_person
$$;

-- ---------------------------------------------------------------------------
-- Member profile (self-service). Never touches past attendance snapshots.
-- ---------------------------------------------------------------------------
create function public.save_my_profile(
  p_title_id uuid, p_title_specify text, p_full_name text,
  p_area_id uuid, p_voice_part_id uuid, p_district text, p_contact text
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare me public.accounts%rowtype; pid uuid; spec text; dg uuid; c text; nm text;
begin
  perform public.rate_check('save_profile', 20, 60);
  select * into me from public.accounts where id = auth.uid() and not disabled;
  if not found then raise exception 'Account not found.'; end if;

  nm := btrim(p_full_name);
  if char_length(nm) < 2 then raise exception 'Please enter your full name.'; end if;
  update public.accounts set full_name = nm where id = me.id;

  -- Reviewers, registrars and admins without a person record only have a name.
  if me.role <> 'member' and me.person_id is null then
    return jsonb_build_object('status', 'saved');
  end if;

  spec := public._clean_specify(p_title_id, p_title_specify);
  perform public._check_lookups(p_area_id, p_voice_part_id);
  dg := public.resolve_district(p_district);
  c := public.normalize_contact(p_contact);

  if me.person_id is null then
    insert into public.people (title_id, title_specify, full_name, area_id, district_group_id,
                               voice_part_id, contact, created_by)
    values (p_title_id, spec, nm, p_area_id, dg, p_voice_part_id, c, me.id)
    returning id into pid;
    update public.accounts set person_id = pid where id = me.id;
  else
    update public.people
       set title_id = p_title_id, title_specify = spec, full_name = nm, area_id = p_area_id,
           district_group_id = dg, voice_part_id = p_voice_part_id, contact = c, updated_at = now()
     where id = me.person_id;
  end if;
  return jsonb_build_object('status', 'saved');
end $$;

create function public.clear_must_set_password() returns void
language sql security definer set search_path = public as $$
  update public.accounts set must_set_password = false where id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Open list and marking attendance
-- ---------------------------------------------------------------------------
create function public.get_open_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare l public.lists%rowtype; r text := public.app_role(); ev text; cnt int;
begin
  if r is null then return null; end if;
  select * into l from public.lists where status = 'open';
  if not found then return null; end if;
  select name into ev from public.events where id = l.event_id;
  if r in ('admin', 'registrar') then
    select count(*) into cnt from public.attendance where list_id = l.id and not removed;
  end if;
  return jsonb_build_object(
    'id', l.id, 'title', l.title, 'event_name', ev,
    'location_check', l.location_check, 'rotating_qr', l.rotating_qr,
    'radius_m', l.radius_m, 'allowed_area_ids', l.allowed_area_ids,
    'present_count', cnt, 'opened_at', l.opened_at);
end $$;

create function public._put_attendance(p_list uuid, p_person uuid, p_method text, p_reactivate boolean)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare ex public.attendance%rowtype; snap jsonb; aid uuid; who text;
begin
  snap := public.person_snapshot(p_person);
  select coalesce(nullif(full_name, ''), email) into who from public.accounts where id = auth.uid();
  select * into ex from public.attendance where list_id = p_list and person_id = p_person;
  if found then
    if not ex.removed then
      return jsonb_build_object('status', 'already', 'attendance_id', ex.id);
    end if;
    if not p_reactivate then
      return jsonb_build_object('status', 'was_removed', 'attendance_id', ex.id);
    end if;
    update public.attendance
       set removed = false, removed_by = null, removed_at = null, removed_reason = null,
           method = p_method, marked_by = auth.uid(), marked_by_name = who,
           marked_at = now(), snapshot = snap
     where id = ex.id;
    return jsonb_build_object('status', 'marked', 'attendance_id', ex.id);
  end if;
  begin
    insert into public.attendance (list_id, person_id, method, marked_by, marked_by_name, snapshot)
    values (p_list, p_person, p_method, auth.uid(), who, snap)
    returning id into aid;
  exception when unique_violation then
    select id into aid from public.attendance where list_id = p_list and person_id = p_person;
    return jsonb_build_object('status', 'already', 'attendance_id', aid);
  end;
  return jsonb_build_object('status', 'marked', 'attendance_id', aid);
end $$;

-- Members mark themselves by scanning the QR code
create function public.mark_my_attendance(
  p_list uuid, p_token text,
  p_lat double precision default null, p_lng double precision default null,
  p_accuracy double precision default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  me public.accounts%rowtype; l public.lists%rowtype; s public.list_secrets%rowtype;
  pr public.people%rowtype; w bigint; ok boolean := false; dist double precision; res jsonb;
begin
  perform public.rate_check('mark_self', 10, 60);
  select * into me from public.accounts where id = auth.uid() and not disabled;
  if not found then raise exception 'Please sign in.'; end if;
  if me.person_id is null then raise exception 'Please finish your profile first.'; end if;

  select * into l from public.lists where id = p_list;
  if not found or l.status <> 'open' then
    raise exception 'Registration is closed.';
  end if;

  select * into s from public.list_secrets where list_id = l.id;
  if l.rotating_qr then
    w := floor(extract(epoch from now()) / l.rotation_seconds)::bigint;
    ok := p_token is not null and (p_token = public.rot_code(s.rotation_secret, w)
                                   or p_token = public.rot_code(s.rotation_secret, w - 1));
  else
    ok := p_token is not null and p_token = s.qr_token;
  end if;
  if not ok then
    raise exception 'This QR code is not valid or has expired. Please scan the current code.';
  end if;

  if l.location_check then
    if p_lat is null or p_lng is null then
      raise exception 'Location is needed for this list. Please allow location access and try again.';
    end if;
    dist := public.distance_m(p_lat, p_lng, l.venue_lat, l.venue_lng)
            - least(greatest(coalesce(p_accuracy, 0), 0), 100);
    if dist > l.radius_m then
      raise exception 'You seem to be too far from the venue to mark attendance.';
    end if;
  end if;

  select * into pr from public.people where id = me.person_id and not archived;
  if not found then raise exception 'Your profile is not active. Please see a registrar.'; end if;
  if cardinality(l.allowed_area_ids) > 0 and not (pr.area_id = any (l.allowed_area_ids)) then
    raise exception 'This list is not open to your area.';
  end if;

  res := public._put_attendance(l.id, pr.id, 'self', false);
  if res->>'status' = 'was_removed' then
    raise exception 'Your attendance for this list was removed. Please see a registrar.';
  end if;
  return res || jsonb_build_object('list_title', l.title);
end $$;

-- Registrars and admins mark someone present
create function public.mark_attendance_manual(p_list uuid, p_person uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r text; l public.lists%rowtype; pr public.people%rowtype; method text;
begin
  r := public.need_role(array['admin', 'registrar']);
  perform public.rate_check('mark_manual', 120, 60);
  select * into l from public.lists where id = p_list;
  if not found or l.status <> 'open' then raise exception 'Registration is closed.'; end if;
  select * into pr from public.people where id = p_person and not archived;
  if not found then raise exception 'Person not found.'; end if;
  if r = 'registrar' and cardinality(l.allowed_area_ids) > 0
     and not (pr.area_id = any (l.allowed_area_ids)) then
    raise exception 'This list is not open to that person''s area.';
  end if;
  method := case when r = 'admin' then 'admin' else 'registrar' end;
  return public._put_attendance(l.id, pr.id, method, true);
end $$;

-- Quick undo right after a mistaken mark (within 2 minutes, by whoever marked)
create function public.undo_attendance(p_att uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare a public.attendance%rowtype; l public.lists%rowtype;
begin
  perform public.need_role(array['admin', 'registrar']);
  select * into a from public.attendance where id = p_att;
  if not found then raise exception 'Attendance record not found.'; end if;
  if a.removed then
    raise exception 'This attendee was already removed. Use Restore instead.';
  end if;
  if a.marked_by is distinct from auth.uid() or a.method = 'self' then
    raise exception 'You can only undo a mark that you made.';
  end if;
  if a.marked_at < now() - interval '120 seconds' then
    raise exception 'The quick undo window has passed. Use Remove instead.';
  end if;
  select * into l from public.lists where id = a.list_id;
  delete from public.attendance where id = a.id;
  perform public.log_action('attendance.undo', 'list', a.list_id::text,
    jsonb_build_object('list_title', l.title, 'person', a.snapshot->>'display_name'));
end $$;

create function public.remove_attendance(p_att uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare a public.attendance%rowtype; l public.lists%rowtype;
begin
  perform public.need_role(array['admin', 'registrar']);
  perform public.rate_check('remove', 60, 60);
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'Please give a reason for removing this attendee.';
  end if;
  select * into a from public.attendance where id = p_att;
  if not found then raise exception 'Attendance record not found.'; end if;
  if a.removed then return; end if;
  select * into l from public.lists where id = a.list_id;
  if l.status = 'archived' then raise exception 'This list is archived.'; end if;
  update public.attendance
     set removed = true, removed_by = auth.uid(), removed_at = now(), removed_reason = btrim(p_reason)
   where id = a.id;
  perform public.log_action('attendance.remove', 'list', a.list_id::text,
    jsonb_build_object('list_title', l.title, 'person', a.snapshot->>'display_name',
                       'person_id', a.person_id, 'reason', btrim(p_reason)));
end $$;

create function public.restore_attendance(p_att uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare a public.attendance%rowtype; l public.lists%rowtype;
begin
  perform public.need_role(array['admin', 'registrar']);
  select * into a from public.attendance where id = p_att;
  if not found then raise exception 'Attendance record not found.'; end if;
  if not a.removed then return; end if;
  select * into l from public.lists where id = a.list_id;
  if l.status = 'archived' then raise exception 'This list is archived.'; end if;
  update public.attendance
     set removed = false, removed_by = null, removed_at = null, removed_reason = null
   where id = a.id;
  perform public.log_action('attendance.restore', 'list', a.list_id::text,
    jsonb_build_object('list_title', l.title, 'person', a.snapshot->>'display_name',
                       'person_id', a.person_id));
end $$;

-- Who is on a list. Registrars only see the open list, and never contact details.
create function public.list_present(p_list uuid, p_include_removed boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare r text; l public.lists%rowtype; res jsonb;
begin
  r := public.need_role(array['admin', 'registrar']);
  select * into l from public.lists where id = p_list;
  if not found then raise exception 'List not found.'; end if;
  if r = 'registrar' and l.status <> 'open' then
    raise exception 'You can only see the list that is open now.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'att_id', at.id,
      'person_id', at.person_id,
      'display_name', at.snapshot->>'display_name',
      'area', at.snapshot->>'area',
      'district', at.snapshot->>'district',
      'voice_part', at.snapshot->>'voice_part',
      'marked_at', at.marked_at,
      'method', at.method,
      'marked_by', at.marked_by,
      'marked_by_name', at.marked_by_name,
      'removed', at.removed,
      'removed_reason', at.removed_reason) order by at.marked_at desc), '[]'::jsonb)
    into res
    from public.attendance at
   where at.list_id = p_list and (p_include_removed or not at.removed);
  return res;
end $$;

-- ---------------------------------------------------------------------------
-- Registrar tools: search, add, edit, archive, delete
-- ---------------------------------------------------------------------------
create function public.search_people(p_q text, p_list uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare q text := btrim(coalesce(p_q, '')); res jsonb;
begin
  perform public.need_role(array['admin', 'registrar']);
  if char_length(q) < 2 then return '[]'::jsonb; end if;
  q := left(q, 60);
  select coalesce(jsonb_agg(public._person_card(x.id, p_list) order by x.score desc, x.full_name), '[]'::jsonb)
    into res
    from (
      select p.id, p.full_name, similarity(p.full_name, q) as score
        from public.people p
       where not p.archived
         and (p.full_name ilike '%' || replace(replace(q, '%', ''), '_', '') || '%'
              or similarity(p.full_name, q) >= 0.3)
       order by similarity(p.full_name, q) desc, p.full_name
       limit 12
    ) x;
  return res;
end $$;

create function public.create_person(
  p_title_id uuid, p_title_specify text, p_full_name text, p_area_id uuid,
  p_voice_part_id uuid, p_district text, p_contact text, p_force boolean default false
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare nm text; spec text; dg uuid; c text; pid uuid; sim_matches jsonb;
begin
  perform public.need_role(array['admin', 'registrar']);
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
  c := public.normalize_contact(p_contact);
  insert into public.people (title_id, title_specify, full_name, area_id, district_group_id,
                             voice_part_id, contact, created_by)
  values (p_title_id, spec, nm, p_area_id, dg, p_voice_part_id, c, auth.uid())
  returning id into pid;
  return jsonb_build_object('status', 'created', 'id', pid);
end $$;

create function public.update_person(
  p_id uuid, p_title_id uuid, p_title_specify text, p_full_name text, p_area_id uuid,
  p_voice_part_id uuid, p_district text, p_contact text
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r text; pr public.people%rowtype; spec text; dg uuid; c text; nm text;
begin
  r := public.need_role(array['admin', 'registrar']);
  select * into pr from public.people where id = p_id;
  if not found then raise exception 'Person not found.'; end if;
  if r = 'registrar' and pr.created_by is distinct from auth.uid() then
    raise exception 'You can only edit people you added.';
  end if;
  nm := btrim(p_full_name);
  if char_length(nm) < 2 then raise exception 'Please enter the full name.'; end if;
  spec := public._clean_specify(p_title_id, p_title_specify);
  perform public._check_lookups(p_area_id, p_voice_part_id);
  dg := public.resolve_district(p_district);
  c := public.normalize_contact(p_contact);
  update public.people
     set title_id = p_title_id, title_specify = spec, full_name = nm, area_id = p_area_id,
         district_group_id = dg, voice_part_id = p_voice_part_id, contact = c, updated_at = now()
   where id = p_id;
end $$;

-- Hides a person from search, keeps their history
create function public.archive_person(p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r text; pr public.people%rowtype;
begin
  r := public.need_role(array['admin', 'registrar']);
  select * into pr from public.people where id = p_id;
  if not found then raise exception 'Person not found.'; end if;
  if r = 'registrar' and pr.created_by is distinct from auth.uid() then
    raise exception 'You can only archive people you added.';
  end if;
  update public.people set archived = true, updated_at = now() where id = p_id;
  perform public.log_action('person.archive', 'person', p_id::text,
    jsonb_build_object('person', pr.full_name));
end $$;

create function public.restore_person(p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare pr public.people%rowtype;
begin
  perform public.need_role(array['admin']);
  select * into pr from public.people where id = p_id;
  if not found then raise exception 'Person not found.'; end if;
  update public.people set archived = false, updated_at = now() where id = p_id;
  perform public.log_action('person.restore', 'person', p_id::text,
    jsonb_build_object('person', pr.full_name));
end $$;

-- Registrars: only people they added with no attendance yet. Admins: anyone without attendance.
create function public.delete_person(p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r text; pr public.people%rowtype;
begin
  r := public.need_role(array['admin', 'registrar']);
  select * into pr from public.people where id = p_id;
  if not found then raise exception 'Person not found.'; end if;
  if r = 'registrar' and pr.created_by is distinct from auth.uid() then
    raise exception 'You can only delete people you added.';
  end if;
  if exists (select 1 from public.attendance where person_id = p_id) then
    raise exception 'This person has attendance history. Archive them instead.';
  end if;
  if exists (select 1 from public.accounts where person_id = p_id) then
    raise exception 'This person has a login account. Archive them instead.';
  end if;
  delete from public.people where id = p_id;
  perform public.log_action('person.delete', 'person', p_id::text,
    jsonb_build_object('person', pr.full_name));
end $$;

-- Admin: join two records of the same person
create function public.merge_people(p_keep uuid, p_merge uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare k public.people%rowtype; m public.people%rowtype; r record;
        ka uuid; ma uuid;
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
  if ma is not null then
    update public.accounts set person_id = null where id = ma;
    update public.accounts set person_id = p_keep where id = ma;
  end if;
  update public.people set archived = true, merged_into = p_keep, updated_at = now() where id = p_merge;
  perform public.log_action('person.merge', 'person', p_keep::text,
    jsonb_build_object('kept', k.full_name, 'merged', m.full_name, 'merged_id', p_merge));
end $$;

-- ---------------------------------------------------------------------------
-- Admin: events and lists
-- ---------------------------------------------------------------------------
create function public.create_event(p_name text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare eid uuid;
begin
  perform public.need_role(array['admin']);
  if char_length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'Please enter an event name.'; end if;
  insert into public.events (name, created_by) values (btrim(p_name), auth.uid()) returning id into eid;
  perform public.log_action('event.create', 'event', eid::text, jsonb_build_object('name', btrim(p_name)));
  return eid;
end $$;

create function public.rename_event(p_id uuid, p_name text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public.need_role(array['admin']);
  if char_length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'Please enter an event name.'; end if;
  update public.events set name = btrim(p_name) where id = p_id;
end $$;

create function public.save_list(
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

create function public.open_list(p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare l public.lists%rowtype; o public.lists%rowtype;
begin
  perform public.need_role(array['admin']);
  select * into l from public.lists where id = p_id for update;
  if not found then raise exception 'List not found.'; end if;
  if l.status = 'open' then return; end if;
  if l.status = 'archived' then raise exception 'Restore this list from the archive before opening it.'; end if;
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

create function public.close_list(p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare l public.lists%rowtype;
begin
  perform public.need_role(array['admin']);
  select * into l from public.lists where id = p_id for update;
  if not found then raise exception 'List not found.'; end if;
  if l.status <> 'open' then return; end if;
  update public.lists set status = 'closed', closed_at = now() where id = p_id;
  perform public.log_action('list.close', 'list', p_id::text, jsonb_build_object('title', l.title));
end $$;

create function public.archive_list(p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare l public.lists%rowtype;
begin
  perform public.need_role(array['admin']);
  select * into l from public.lists where id = p_id for update;
  if not found then raise exception 'List not found.'; end if;
  if l.status = 'open' then raise exception 'Close this list before archiving it.'; end if;
  if l.status = 'archived' then return; end if;
  update public.lists set status = 'archived', archived_at = now() where id = p_id;
  perform public.log_action('list.archive', 'list', p_id::text, jsonb_build_object('title', l.title));
end $$;

create function public.unarchive_list(p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare l public.lists%rowtype;
begin
  perform public.need_role(array['admin']);
  select * into l from public.lists where id = p_id for update;
  if not found then raise exception 'List not found.'; end if;
  if l.status <> 'archived' then return; end if;
  update public.lists
     set status = case when opened_at is null then 'draft' else 'closed' end, archived_at = null
   where id = p_id;
  perform public.log_action('list.unarchive', 'list', p_id::text, jsonb_build_object('title', l.title));
end $$;

-- Permanent. Only an archived list, and only when its title is typed exactly.
create function public.delete_list(p_id uuid, p_confirm text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare l public.lists%rowtype; n int; ev text;
begin
  perform public.need_role(array['admin']);
  select * into l from public.lists where id = p_id for update;
  if not found then raise exception 'List not found.'; end if;
  if l.status <> 'archived' then raise exception 'Archive this list before deleting it.'; end if;
  if btrim(coalesce(p_confirm, '')) <> l.title then
    raise exception 'The typed title does not match. Nothing was deleted.';
  end if;
  select count(*) into n from public.attendance where list_id = p_id;
  select name into ev from public.events where id = l.event_id;
  delete from public.lists where id = p_id;
  perform public.log_action('list.delete', 'list', p_id::text,
    jsonb_build_object('title', l.title, 'event', ev, 'attendance_records', n));
end $$;

-- ---------------------------------------------------------------------------
-- QR codes (admins download the static one, admins/registrars show the rotating one)
-- ---------------------------------------------------------------------------
create function public.get_qr_payload(p_list uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r text; l public.lists%rowtype; s public.list_secrets%rowtype; w bigint; secs int;
begin
  r := public.need_role(array['admin', 'registrar']);
  perform public.rate_check('qr', 120, 60);
  select * into l from public.lists where id = p_list;
  if not found then raise exception 'List not found.'; end if;
  select * into s from public.list_secrets where list_id = p_list;
  if l.rotating_qr then
    if l.status <> 'open' then raise exception 'This list is not open.'; end if;
    w := floor(extract(epoch from now()) / l.rotation_seconds)::bigint;
    secs := l.rotation_seconds - (extract(epoch from now())::bigint % l.rotation_seconds)::int;
    return jsonb_build_object('mode', 'rotating', 'token', public.rot_code(s.rotation_secret, w),
                              'seconds_left', secs, 'rotation_seconds', l.rotation_seconds,
                              'list_id', l.id, 'title', l.title);
  end if;
  if r <> 'admin' then
    raise exception 'Rotating QR is off for this list. Only admins can show the printable QR code.';
  end if;
  return jsonb_build_object('mode', 'static', 'token', s.qr_token, 'list_id', l.id, 'title', l.title);
end $$;

-- ---------------------------------------------------------------------------
-- Admin: accounts, reviewer grants, districts, exports
-- ---------------------------------------------------------------------------
create function public.set_account_disabled(p_id uuid, p_disabled boolean) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare a public.accounts%rowtype;
begin
  perform public.need_role(array['admin']);
  select * into a from public.accounts where id = p_id;
  if not found then raise exception 'Account not found.'; end if;
  if p_id = auth.uid() then raise exception 'You cannot disable your own account.'; end if;
  if p_disabled and a.role = 'admin'
     and not exists (select 1 from public.accounts where role = 'admin' and not disabled and id <> p_id) then
    raise exception 'At least one active admin must remain.';
  end if;
  update public.accounts set disabled = p_disabled where id = p_id;
  perform public.log_action(case when p_disabled then 'account.disable' else 'account.enable' end,
    'account', p_id::text, jsonb_build_object('email', a.email, 'role', a.role));
end $$;

create function public.link_account_person(p_account uuid, p_person uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare a public.accounts%rowtype;
begin
  perform public.need_role(array['admin']);
  select * into a from public.accounts where id = p_account;
  if not found then raise exception 'Account not found.'; end if;
  if a.person_id is not null then
    raise exception 'This account is already linked to a person. Use Merge to join two records.';
  end if;
  if exists (select 1 from public.accounts where person_id = p_person) then
    raise exception 'That person already has an account.';
  end if;
  if not exists (select 1 from public.people where id = p_person) then
    raise exception 'Person not found.';
  end if;
  update public.accounts set person_id = p_person where id = p_account;
  perform public.log_action('account.link', 'account', p_account::text,
    jsonb_build_object('email', a.email, 'person_id', p_person));
end $$;

create function public.grant_reviewer(p_account uuid, p_event uuid, p_list uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare a public.accounts%rowtype;
begin
  perform public.need_role(array['admin']);
  select * into a from public.accounts where id = p_account;
  if not found or a.role <> 'reviewer' then raise exception 'Choose a reviewer account.'; end if;
  if (p_event is null) = (p_list is null) then raise exception 'Choose either an event or a list.'; end if;
  insert into public.reviewer_grants (account_id, event_id, list_id, created_by)
  values (p_account, p_event, p_list, auth.uid())
  on conflict do nothing;
  perform public.log_action('grant.add', 'account', p_account::text,
    jsonb_build_object('email', a.email, 'event_id', p_event, 'list_id', p_list));
end $$;

create function public.revoke_grant(p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare g public.reviewer_grants%rowtype;
begin
  perform public.need_role(array['admin']);
  select * into g from public.reviewer_grants where id = p_id;
  if not found then return; end if;
  delete from public.reviewer_grants where id = p_id;
  perform public.log_action('grant.remove', 'account', g.account_id::text,
    jsonb_build_object('event_id', g.event_id, 'list_id', g.list_id));
end $$;

create function public.rename_district(p_id uuid, p_name text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare g public.district_groups%rowtype; n text := btrim(coalesce(p_name, ''));
begin
  perform public.need_role(array['admin']);
  if char_length(n) < 2 then raise exception 'Please enter a district name.'; end if;
  select * into g from public.district_groups where id = p_id;
  if not found then raise exception 'District not found.'; end if;
  if exists (select 1 from public.district_groups where lower(name) = lower(n) and id <> p_id) then
    raise exception 'A district with that name already exists. Use Merge instead.';
  end if;
  update public.district_groups set name = n where id = p_id;
  insert into public.district_variants (group_id, variant)
    values (p_id, left(public.normalize_district(n), 80)) on conflict (variant) do nothing;
  perform public.log_action('district.rename', 'district', p_id::text,
    jsonb_build_object('from', g.name, 'to', n));
end $$;

create function public.merge_districts(p_from uuid, p_to uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare f public.district_groups%rowtype; t public.district_groups%rowtype;
begin
  perform public.need_role(array['admin']);
  if p_from = p_to then raise exception 'Choose two different districts.'; end if;
  select * into f from public.district_groups where id = p_from;
  select * into t from public.district_groups where id = p_to;
  if f.id is null or t.id is null then raise exception 'District not found.'; end if;
  update public.district_variants set group_id = p_to where group_id = p_from;
  update public.people set district_group_id = p_to where district_group_id = p_from;
  delete from public.district_groups where id = p_from;
  perform public.log_action('district.merge', 'district', p_to::text,
    jsonb_build_object('merged', f.name, 'into', t.name));
end $$;

create function public.log_export(p_scope text, p_target uuid, p_format text, p_details jsonb default '{}'::jsonb)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r text; ok boolean; title text;
begin
  r := public.need_role(array['admin', 'reviewer']);
  if p_scope not in ('list', 'event', 'signup') then raise exception 'Unknown export scope.'; end if;
  if p_scope = 'signup' and r <> 'admin' then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  if r = 'reviewer' then
    ok := case when p_scope = 'list' then public.can_review_list(p_target)
                else public.can_review_event(p_target) end;
    if not ok then raise exception 'You do not have access to that.' using errcode = '42501'; end if;
  end if;
  if p_scope = 'list' then
    select l.title into title from public.lists l where l.id = p_target;
  elsif p_scope = 'signup' then
    select l.title into title from public.signup_lists l where l.id = p_target;
  else
    select e.name into title from public.events e where e.id = p_target;
  end if;
  perform public.log_action('export', p_scope, p_target::text,
    coalesce(p_details, '{}'::jsonb) || jsonb_build_object('format', p_format, 'name', title));
end $$;


-- ---------------------------------------------------------------------------
-- Reading helpers for dashboards
-- ---------------------------------------------------------------------------

-- A member's own attendance history (members cannot read the lists table)
create function public.my_history() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'list_id', a.list_id, 'list_title', l.title,
           'event_name', e.name, 'marked_at', a.marked_at) order by a.marked_at desc), '[]'::jsonb)
    from public.attendance a
    join public.lists l on l.id = a.list_id
    join public.events e on e.id = l.event_id
   where a.person_id = public.my_person_id() and not a.removed
$$;

-- Counts per list, with area and voice part breakdowns (admins, and reviewers for granted lists)
create function public.event_breakdown(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r text; res jsonb;
begin
  r := public.need_role(array['admin', 'reviewer']);
  if r = 'reviewer' and not public.can_review_event(p_event) then
    raise exception 'You do not have access to that.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.sort_at), '[]'::jsonb) into res
  from (
    select l.id as list_id, l.title, l.status, l.opened_at,
           coalesce(l.opened_at, l.created_at) as sort_at,
           (select count(*) from public.attendance a where a.list_id = l.id and not a.removed) as total,
           (select coalesce(jsonb_object_agg(k, c), '{}'::jsonb) from (
              select coalesce(a.snapshot->>'area', 'Unknown') as k, count(*) as c
                from public.attendance a where a.list_id = l.id and not a.removed group by 1) s) as areas,
           (select coalesce(jsonb_object_agg(k, c), '{}'::jsonb) from (
              select coalesce(a.snapshot->>'voice_part', 'Unknown') as k, count(*) as c
                from public.attendance a where a.list_id = l.id and not a.removed group by 1) s) as voices,
           (select coalesce(jsonb_object_agg(k, c), '{}'::jsonb) from (
              select coalesce(a.snapshot->>'district', 'Unknown') as k, count(*) as c
                from public.attendance a where a.list_id = l.id and not a.removed group by 1) s) as districts
      from public.lists l
     where l.event_id = p_event and l.status <> 'archived'
       and (r = 'admin' or public.can_review_list(l.id))
  ) x;
  return res;
end $$;

create function public.district_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.need_role(array['admin']);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', g.id, 'name', g.name,
             'people', (select count(*) from public.people p where p.district_group_id = g.id),
             'variants', (select coalesce(jsonb_agg(v.variant order by v.variant), '[]'::jsonb)
                            from public.district_variants v where v.group_id = g.id))
           order by g.name)
      from public.district_groups g), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Triggers: new login -> account row; new list -> its secrets
-- ---------------------------------------------------------------------------
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text := coalesce(new.raw_app_meta_data->>'role', 'member');
begin
  -- Visitors of the public sign-up page are anonymous sessions: they never get an account.
  if coalesce(new.is_anonymous, false) then return new; end if;
  if r not in ('admin', 'reviewer', 'registrar', 'member') then r := 'member'; end if;
  insert into public.accounts (id, email, full_name, role)
  values (new.id, new.email, nullif(btrim(coalesce(new.raw_user_meta_data->>'full_name', '')), ''), r)
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create function public._create_list_secrets() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into public.list_secrets (list_id) values (new.id);
  return new;
end $$;

create trigger on_list_created after insert on public.lists
  for each row execute function public._create_list_secrets();

-- ============================================================================
-- SIGN-UP LISTS (public sign-up by QR code or shared link, no account needed)
--
-- Visitors use an anonymous Supabase session (created after the human check),
-- so the usual per-user rate limits work. Anonymous sessions have no accounts
-- row, so they can call nothing except the two public functions below.
-- ============================================================================

-- Name comparison key: lower case, no punctuation, no title words, words sorted,
-- so "Brother Chanda Mulenga" and "mulenga  chanda" are the same key.
create function public.name_key(p text) returns text
language sql immutable as $$
  select coalesce((
    select string_agg(t, ' ' order by t)
      from unnest(regexp_split_to_array(
             btrim(regexp_replace(lower(coalesce(p, '')), '[^a-z0-9 ]', ' ', 'g')), '\s+')) as t
     where t <> '' and t not in ('brother', 'sister', 'minister', 'bro', 'sis')), '')
$$;

-- "Mulenga Chanda" -> "Mulenga C." (shown to the public when a similar name exists)
create function public.mask_name(p text) returns text
language sql immutable as $$
  select case
           when coalesce(array_length(parts, 1), 0) = 0 then ''
           when array_length(parts, 1) = 1 then parts[1]
           else parts[1] || ' ' || upper(left(parts[array_length(parts, 1)], 1)) || '.'
         end
    from (select regexp_split_to_array(btrim(coalesce(p, '')), '\s+') as parts) x
$$;

-- Rate limit not tied to an account (keyed by list or by network address)
create function public.rate_check_key(p_key text, p_max int, p_seconds int) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare n int;
begin
  select count(*) into n from public.rate_events
   where actor is null and action = p_key
     and at > now() - make_interval(secs => p_seconds);
  if n >= p_max then
    raise exception 'Too many requests. Please wait a moment and try again.';
  end if;
  insert into public.rate_events (actor, action) values (null, p_key);
end $$;

-- Network address of the caller, when the API passes it on
create function public._client_ip() returns text
language plpgsql stable as $$
declare h text; ip text;
begin
  h := current_setting('request.headers', true);
  if h is null or h = '' then return 'unknown'; end if;
  ip := btrim(split_part(coalesce(h::json->>'cf-connecting-ip', h::json->>'x-forwarded-for', ''), ',', 1));
  return coalesce(nullif(ip, ''), 'unknown');
exception when others then
  return 'unknown';
end $$;

-- Duplicate rules for sign-up lists:
--   already = same name (any word order, titles ignored) in the same district  -> blocked for the public
--   similar = a very similar name (50% or more) or the same name elsewhere     -> asks "is this a different person?"
create function public._signup_check(p_list uuid, p_name text, p_dg uuid, p_exclude uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare k text := public.name_key(p_name); st text := 'new'; m jsonb;
begin
  if k = '' then return jsonb_build_object('status', 'invalid', 'matches', '[]'::jsonb); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'name', x.dn, 'full_name', x.full_name, 'exact', x.exact, 'same_district', x.sd)
           order by x.exact desc, x.score desc), '[]'::jsonb)
    into m
    from (
      select e.id, e.full_name, public.display_name(t.name, e.title_specify, e.full_name) as dn,
             (e.name_key = k) as exact,
             (p_dg is null or e.district_group_id is null or e.district_group_id = p_dg) as sd,
             similarity(e.name_key, k) as score
        from public.signup_entries e
        left join public.titles t on t.id = e.title_id
       where e.list_id = p_list and not e.removed and e.id is distinct from p_exclude
         and (e.name_key = k or similarity(e.name_key, k) >= 0.5)
       order by (e.name_key = k) desc, similarity(e.name_key, k) desc
       limit 5
    ) x;
  if exists (select 1 from jsonb_array_elements(m) a
              where (a->>'exact')::boolean and (a->>'same_district')::boolean) then
    st := 'already';
  elsif jsonb_array_length(m) > 0 then
    st := 'similar';
  end if;
  return jsonb_build_object('status', st, 'matches', m);
end $$;

create function public._signup_insert(
  p_list uuid, p_title uuid, p_spec text, p_name text, p_area uuid, p_dg uuid,
  p_voice uuid, p_contact text, p_source text, p_forced boolean
) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare eid uuid; who text;
begin
  select coalesce(nullif(full_name, ''), email) into who from public.accounts where id = auth.uid();
  insert into public.signup_entries (list_id, title_id, title_specify, full_name, name_key, area_id,
                                     district_group_id, voice_part_id, contact, source,
                                     added_by, added_by_name, forced)
  values (p_list, p_title, p_spec, p_name, public.name_key(p_name), p_area, p_dg, p_voice, p_contact, p_source,
          case when p_source = 'public' then null else auth.uid() end,
          case when p_source = 'public' then null else who end,
          coalesce(p_forced, false))
  returning id into eid;
  return eid;
end $$;

-- ---------------------------------------------------------------------------
-- Public: what the sign-up page needs to draw itself (no login needed)
-- ---------------------------------------------------------------------------
create function public.signup_public_info(p_code text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare l public.signup_lists%rowtype; ip text;
begin
  ip := public._client_ip();
  if ip <> 'unknown' then perform public.rate_check_key('signup_info:' || ip, 120, 600); end if;
  select * into l from public.signup_lists where code = btrim(coalesce(p_code, ''));
  if not found then
    raise exception 'This link is not valid. Please ask for the current link or QR code.';
  end if;
  return jsonb_build_object(
    'title', l.title,
    'open', l.status = 'open',
    'location_check', l.location_check,
    'titles', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'needs_specify', t.needs_specify)
                                         order by t.sort, t.name), '[]'::jsonb)
                 from public.titles t where t.active),
    'areas', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name) order by a.sort, a.name), '[]'::jsonb)
                from public.areas a
               where a.active and (cardinality(l.allowed_area_ids) = 0 or a.id = any (l.allowed_area_ids))),
    'voices', (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name) order by v.sort, v.name), '[]'::jsonb)
                 from public.voice_parts v
                where v.active and (cardinality(l.voice_part_ids) = 0 or v.id = any (l.voice_part_ids))));
end $$;

-- ---------------------------------------------------------------------------
-- Public: send in a sign-up (needs an anonymous or signed-in session)
-- ---------------------------------------------------------------------------
create function public.signup_submit(
  p_code text, p_title_id uuid, p_title_specify text, p_full_name text, p_area_id uuid,
  p_voice_part_id uuid, p_district text, p_contact text,
  p_lat double precision default null, p_lng double precision default null,
  p_accuracy double precision default null, p_force boolean default false
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  l public.signup_lists%rowtype; nm text; spec text; dg uuid; c text; chk jsonb;
  dist double precision; ip text;
begin
  if auth.uid() is null then raise exception 'Please try again.'; end if;
  perform public.rate_check('signup_submit', 20, 600);

  select * into l from public.signup_lists where code = btrim(coalesce(p_code, ''));
  if not found then
    raise exception 'This link is not valid. Please ask for the current link or QR code.';
  end if;
  perform public.rate_check_key('signup_list:' || l.id::text, 600, 600);
  ip := public._client_ip();
  if ip <> 'unknown' then perform public.rate_check_key('signup_ip:' || ip, 60, 600); end if;
  if l.status <> 'open' then raise exception 'Sign-ups are closed.'; end if;

  nm := btrim(coalesce(p_full_name, ''));
  if char_length(nm) < 2 then raise exception 'Please enter your full name.'; end if;
  if char_length(nm) > 80 then raise exception 'That name is too long.'; end if;
  spec := public._clean_specify(p_title_id, p_title_specify);
  perform public._check_lookups(p_area_id, p_voice_part_id);
  if cardinality(l.allowed_area_ids) > 0 and not (p_area_id = any (l.allowed_area_ids)) then
    raise exception 'This sign-up is not open to that area.';
  end if;
  if cardinality(l.voice_part_ids) > 0 and not (p_voice_part_id = any (l.voice_part_ids)) then
    raise exception 'Please choose one of the voice parts shown.';
  end if;

  if l.location_check then
    if p_lat is null or p_lng is null then
      raise exception 'Location is needed for this sign-up. Please allow location access and try again.';
    end if;
    dist := public.distance_m(p_lat, p_lng, l.venue_lat, l.venue_lng)
            - least(greatest(coalesce(p_accuracy, 0), 0), 100);
    if dist > l.radius_m then
      raise exception 'You seem to be too far from the venue to sign up.';
    end if;
  end if;

  dg := public.resolve_district(p_district);
  c := public.normalize_contact(p_contact);

  chk := public._signup_check(l.id, nm, dg, null);
  if chk->>'status' = 'already' then
    return jsonb_build_object('status', 'already', 'title', l.title);
  elsif chk->>'status' = 'similar' and not coalesce(p_force, false) then
    return jsonb_build_object('status', 'similar', 'match', public.mask_name(chk->'matches'->0->>'full_name'));
  end if;

  perform public._signup_insert(l.id, p_title_id, spec, nm, p_area_id, dg, p_voice_part_id, c,
                                'public', chk->>'status' <> 'new');
  return jsonb_build_object('status', 'created', 'title', l.title);
end $$;

-- ---------------------------------------------------------------------------
-- Staff: sign-up lists (admins: everything; registrars: only the open list)
-- ---------------------------------------------------------------------------
create function public.signup_lists_overview() returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare r text;
begin
  r := public.need_role(array['admin', 'registrar']);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', l.id, 'title', l.title, 'status', l.status, 'opened_at', l.opened_at,
             'created_at', l.created_at,
             'entries', (select count(*) from public.signup_entries e where e.list_id = l.id and not e.removed))
           order by (l.status = 'open') desc, l.created_at desc)
      from public.signup_lists l
     where r = 'admin' or l.status = 'open'), '[]'::jsonb);
end $$;

create function public.signup_get(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare r text; l public.signup_lists%rowtype;
begin
  r := public.need_role(array['admin', 'registrar']);
  select * into l from public.signup_lists where id = p_id;
  if not found then raise exception 'Sign-up list not found.'; end if;
  if r = 'registrar' and l.status <> 'open' then
    raise exception 'You can only see the sign-up list that is open now.';
  end if;
  return jsonb_build_object(
    'id', l.id, 'title', l.title, 'status', l.status, 'code', l.code,
    'voice_part_ids', l.voice_part_ids, 'allowed_area_ids', l.allowed_area_ids,
    'location_check', l.location_check, 'venue_lat', l.venue_lat, 'venue_lng', l.venue_lng,
    'radius_m', l.radius_m, 'opened_at', l.opened_at,
    'entries', (select count(*) from public.signup_entries e where e.list_id = l.id and not e.removed));
end $$;

create function public.signup_save(
  p_id uuid, p_title text, p_voices uuid[], p_areas uuid[],
  p_location boolean, p_lat double precision, p_lng double precision, p_radius int
) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare lid uuid; vs uuid[] := coalesce(p_voices, '{}'); ar uuid[] := coalesce(p_areas, '{}');
begin
  perform public.need_role(array['admin']);
  if char_length(btrim(coalesce(p_title, ''))) < 2 then raise exception 'Please enter a title.'; end if;
  if (select count(*) from public.voice_parts where id = any (vs)) <> cardinality(vs) then
    raise exception 'One of the chosen voice parts does not exist.';
  end if;
  if (select count(*) from public.areas where id = any (ar)) <> cardinality(ar) then
    raise exception 'One of the chosen areas does not exist.';
  end if;
  if p_location and (p_lat is null or p_lng is null) then
    raise exception 'Set the venue location, or turn the location check off.';
  end if;
  if p_id is null then
    insert into public.signup_lists (title, voice_part_ids, allowed_area_ids, location_check,
                                     venue_lat, venue_lng, radius_m, created_by)
    values (btrim(p_title), vs, ar, p_location, p_lat, p_lng, coalesce(p_radius, 200), auth.uid())
    returning id into lid;
    perform public.log_action('signup.create', 'signup', lid::text, jsonb_build_object('title', btrim(p_title)));
  else
    update public.signup_lists
       set title = btrim(p_title), voice_part_ids = vs, allowed_area_ids = ar,
           location_check = p_location, venue_lat = p_lat, venue_lng = p_lng,
           radius_m = coalesce(p_radius, 200)
     where id = p_id
     returning id into lid;
    if lid is null then raise exception 'Sign-up list not found.'; end if;
  end if;
  return lid;
end $$;

-- Open or close sign-ups (admins only). Only one sign-up list can be open at a time.
create function public.signup_set_open(p_id uuid, p_open boolean) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare l public.signup_lists%rowtype; o public.signup_lists%rowtype;
begin
  perform public.need_role(array['admin']);
  select * into l from public.signup_lists where id = p_id for update;
  if not found then raise exception 'Sign-up list not found.'; end if;
  if p_open then
    if l.status = 'open' then return; end if;
    select * into o from public.signup_lists where status = 'open';
    if found then
      raise exception 'Sign-ups for "%" are already open. Close them before opening another list.', o.title;
    end if;
    begin
      update public.signup_lists set status = 'open', opened_at = now(), closed_at = null where id = p_id;
    exception when unique_violation then
      raise exception 'Another sign-up list was just opened. Close it before opening this one.';
    end;
    perform public.log_action('signup.open', 'signup', p_id::text, jsonb_build_object('title', l.title));
  else
    if l.status <> 'open' then return; end if;
    update public.signup_lists set status = 'closed', closed_at = now() where id = p_id;
    perform public.log_action('signup.close', 'signup', p_id::text, jsonb_build_object('title', l.title));
  end if;
end $$;

-- New link: the old link and every printed or shared QR code stop working at once
create function public.signup_new_link(p_id uuid) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare l public.signup_lists%rowtype; c text;
begin
  perform public.need_role(array['admin']);
  select * into l from public.signup_lists where id = p_id for update;
  if not found then raise exception 'Sign-up list not found.'; end if;
  c := encode(extensions.gen_random_bytes(12), 'hex');
  update public.signup_lists set code = c where id = p_id;
  perform public.log_action('signup.newlink', 'signup', p_id::text, jsonb_build_object('title', l.title));
  return c;
end $$;

-- Permanent. Only a closed list, and only when its title is typed exactly.
create function public.signup_delete(p_id uuid, p_confirm text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare l public.signup_lists%rowtype; n int;
begin
  perform public.need_role(array['admin']);
  select * into l from public.signup_lists where id = p_id for update;
  if not found then raise exception 'Sign-up list not found.'; end if;
  if l.status = 'open' then raise exception 'Close sign-ups before deleting this list.'; end if;
  if btrim(coalesce(p_confirm, '')) <> l.title then
    raise exception 'The typed title does not match. Nothing was deleted.';
  end if;
  select count(*) into n from public.signup_entries where list_id = p_id;
  delete from public.signup_lists where id = p_id;
  perform public.log_action('signup.delete', 'signup', p_id::text,
    jsonb_build_object('title', l.title, 'entries', n));
end $$;

-- ---------------------------------------------------------------------------
-- Staff: entries
-- ---------------------------------------------------------------------------
create function public.signup_entries(p_list uuid, p_include_removed boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare r text; l public.signup_lists%rowtype; res jsonb;
begin
  r := public.need_role(array['admin', 'registrar']);
  select * into l from public.signup_lists where id = p_list;
  if not found then raise exception 'Sign-up list not found.'; end if;
  if r = 'registrar' and l.status <> 'open' then
    raise exception 'You can only see the sign-up list that is open now.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id,
      'display_name', public.display_name(t.name, e.title_specify, e.full_name),
      'title_id', e.title_id, 'title_specify', e.title_specify, 'full_name', e.full_name,
      'area_id', e.area_id, 'area', a.name,
      'district', g.name,
      'voice_part_id', e.voice_part_id, 'voice_part', v.name,
      'contact', case when r = 'admin' then e.contact else null end,
      'source', e.source, 'added_by_name', e.added_by_name, 'forced', e.forced,
      'created_at', e.created_at,
      'removed', e.removed, 'removed_reason', e.removed_reason,
      'person_id', e.person_id,
      'person_name', (select public.display_name(pt.name, p.title_specify, p.full_name)
                        from public.people p left join public.titles pt on pt.id = p.title_id
                       where p.id = e.person_id and r = 'admin'),
      'can_edit', (r = 'admin' or coalesce(e.added_by = auth.uid(), false))) order by e.created_at desc), '[]'::jsonb)
    into res
    from public.signup_entries e
    left join public.titles t on t.id = e.title_id
    left join public.areas a on a.id = e.area_id
    left join public.district_groups g on g.id = e.district_group_id
    left join public.voice_parts v on v.id = e.voice_part_id
   where e.list_id = p_list and (p_include_removed or not e.removed);
  return res;
end $$;

-- Turns one typed row into checked values (shared by paste and edit). Raises a plain message if invalid.
create function public._signup_row(p_list public.signup_lists, p_row jsonb)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  tid uuid := nullif(p_row->>'title_id', '')::uuid;
  aid uuid := nullif(p_row->>'area_id', '')::uuid;
  vid uuid := nullif(p_row->>'voice_part_id', '')::uuid;
  nm text := btrim(coalesce(p_row->>'name', ''));
  dist text := btrim(coalesce(p_row->>'district', ''));
  spec text; dg uuid; c text;
begin
  if char_length(nm) < 2 then raise exception 'Name is missing or too short.'; end if;
  if char_length(nm) > 80 then raise exception 'Name is too long.'; end if;
  if public.name_key(nm) = '' then raise exception 'Name has no letters.'; end if;
  if tid is not null then spec := public._clean_specify(tid, p_row->>'title_specify'); end if;
  if aid is not null then
    if not exists (select 1 from public.areas where id = aid and active) then raise exception 'Unknown area.'; end if;
    if cardinality(p_list.allowed_area_ids) > 0 and not (aid = any (p_list.allowed_area_ids)) then
      raise exception 'This list is not open to that area.';
    end if;
  end if;
  if vid is not null then
    if not exists (select 1 from public.voice_parts where id = vid and active) then raise exception 'Unknown voice part.'; end if;
    if cardinality(p_list.voice_part_ids) > 0 and not (vid = any (p_list.voice_part_ids)) then
      raise exception 'That voice part is not offered on this list.';
    end if;
  end if;
  if char_length(dist) >= 2 then dg := public.resolve_district(dist); end if;
  c := public.normalize_contact(p_row->>'contact');
  return jsonb_build_object('title_id', tid, 'spec', spec, 'name', nm, 'area_id', aid,
                            'dg', dg, 'voice_id', vid, 'contact', c);
end $$;

-- Paste a list: one row per person. p_commit = false only checks and reports.
-- Row fields: title_id, title_specify, name, area_id, district, voice_part_id, contact, force (boolean)
create function public.signup_paste(p_list uuid, p_rows jsonb, p_commit boolean default false) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  r text; l public.signup_lists%rowtype; rw jsonb; i int := 0; v jsonb; chk jsonb; st text; msg text;
  results jsonb := '[]'::jsonb; seen jsonb := '[]'::jsonb; b jsonb; bst text; bmatch text;
  n_new int := 0; n_added int := 0; n_similar int := 0; n_already int := 0; n_invalid int := 0;
  forced boolean;
begin
  r := public.need_role(array['admin', 'registrar']);
  perform public.rate_check('signup_paste', 20, 60);
  select * into l from public.signup_lists where id = p_list;
  if not found then raise exception 'Sign-up list not found.'; end if;
  if r = 'registrar' and l.status <> 'open' then
    raise exception 'You can only add to the sign-up list that is open now.';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'There is nothing to add.';
  end if;
  if jsonb_array_length(p_rows) > 300 then raise exception 'Please add at most 300 people at a time.'; end if;

  for rw in select * from jsonb_array_elements(p_rows) loop
    i := i + 1; st := null; msg := null; chk := null;
    begin
      v := public._signup_row(l, rw);
      chk := public._signup_check(l.id, v->>'name', nullif(v->>'dg', '')::uuid, null);
      st := chk->>'status';
      -- also compare with the rows earlier in this same paste
      if st = 'new' then
        for b in select * from jsonb_array_elements(seen) loop
          if b->>'key' = public.name_key(v->>'name') then
            if coalesce(b->>'dg', '') = coalesce(v->>'dg', '') or b->>'dg' is null or v->>'dg' is null then
              st := 'already'; msg := 'Same name as line ' || (b->>'line') || ' in this paste.';
            elsif st <> 'already' then st := 'similar'; msg := 'Same name as line ' || (b->>'line') || ' in this paste.'; end if;
          elsif similarity(b->>'key', public.name_key(v->>'name')) >= 0.5 and st = 'new' then
            st := 'similar'; msg := 'Looks like line ' || (b->>'line') || ' in this paste.';
          end if;
        end loop;
      end if;
      if msg is null and st <> 'new' then
        msg := 'Looks like ' || (chk->'matches'->0->>'name') || ' (already on this list).';
      end if;
      seen := seen || jsonb_build_array(jsonb_build_object(
                'key', public.name_key(v->>'name'), 'dg', v->>'dg', 'line', i));
      forced := coalesce((rw->>'force')::boolean, false);
      if st = 'new' then
        n_new := n_new + 1;
        if p_commit then
          perform public._signup_insert(l.id, nullif(v->>'title_id', '')::uuid, v->>'spec', v->>'name',
                    nullif(v->>'area_id', '')::uuid, nullif(v->>'dg', '')::uuid,
                    nullif(v->>'voice_id', '')::uuid, v->>'contact', 'paste', false);
          n_added := n_added + 1; st := 'added';
        end if;
      else
        if st = 'already' then n_already := n_already + 1; else n_similar := n_similar + 1; end if;
        if p_commit and forced then
          perform public._signup_insert(l.id, nullif(v->>'title_id', '')::uuid, v->>'spec', v->>'name',
                    nullif(v->>'area_id', '')::uuid, nullif(v->>'dg', '')::uuid,
                    nullif(v->>'voice_id', '')::uuid, v->>'contact', 'paste', true);
          n_added := n_added + 1; st := 'added';
        elsif p_commit then
          st := 'skipped';
        end if;
      end if;
    exception when others then
      st := 'invalid'; msg := SQLERRM; n_invalid := n_invalid + 1;
    end;
    results := results || jsonb_build_array(jsonb_build_object('idx', i, 'status', st, 'message', msg));
  end loop;

  if p_commit and n_added > 0 then
    perform public.log_action('signup.paste', 'signup', l.id::text,
      jsonb_build_object('title', l.title, 'added', n_added, 'rows', i));
  end if;
  return jsonb_build_object('rows', results, 'new', n_new, 'added', n_added,
                            'similar', n_similar, 'already', n_already, 'invalid', n_invalid);
end $$;

create function public.signup_update_entry(
  p_id uuid, p_title_id uuid, p_title_specify text, p_full_name text, p_area_id uuid,
  p_voice_part_id uuid, p_district text, p_contact text, p_force boolean default false
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  r text; e public.signup_entries%rowtype; l public.signup_lists%rowtype; v jsonb; chk jsonb;
begin
  r := public.need_role(array['admin', 'registrar']);
  select * into e from public.signup_entries where id = p_id;
  if not found then raise exception 'Entry not found.'; end if;
  select * into l from public.signup_lists where id = e.list_id;
  if r = 'registrar' and (e.added_by is distinct from auth.uid() or l.status <> 'open') then
    raise exception 'You can only edit entries you added.';
  end if;
  if e.removed then raise exception 'This entry was removed.'; end if;
  v := public._signup_row(l, jsonb_build_object(
         'title_id', p_title_id, 'title_specify', p_title_specify, 'name', p_full_name,
         'area_id', p_area_id, 'voice_part_id', p_voice_part_id, 'district', p_district,
         'contact', p_contact));
  chk := public._signup_check(l.id, v->>'name', nullif(v->>'dg', '')::uuid, e.id);
  if chk->>'status' <> 'new' and not coalesce(p_force, false) then
    return jsonb_build_object('status', chk->>'status', 'matches', chk->'matches');
  end if;
  update public.signup_entries
     set title_id = nullif(v->>'title_id', '')::uuid, title_specify = v->>'spec', full_name = v->>'name',
         name_key = public.name_key(v->>'name'), area_id = nullif(v->>'area_id', '')::uuid,
         district_group_id = nullif(v->>'dg', '')::uuid, voice_part_id = nullif(v->>'voice_id', '')::uuid,
         contact = v->>'contact', forced = (chk->>'status' <> 'new')
   where id = e.id;
  return jsonb_build_object('status', 'saved');
end $$;

create function public.signup_remove_entry(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r text; e public.signup_entries%rowtype; l public.signup_lists%rowtype;
begin
  r := public.need_role(array['admin', 'registrar']);
  perform public.rate_check('signup_remove', 60, 60);
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'Please give a reason for removing this entry.';
  end if;
  select * into e from public.signup_entries where id = p_id;
  if not found then raise exception 'Entry not found.'; end if;
  select * into l from public.signup_lists where id = e.list_id;
  if r = 'registrar' and (e.added_by is distinct from auth.uid() or l.status <> 'open') then
    raise exception 'You can only remove entries you added.';
  end if;
  if e.removed then return; end if;
  update public.signup_entries
     set removed = true, removed_by = auth.uid(), removed_at = now(), removed_reason = btrim(p_reason)
   where id = e.id;
  perform public.log_action('signup.remove_entry', 'signup', l.id::text,
    jsonb_build_object('title', l.title, 'person', e.full_name, 'reason', btrim(p_reason)));
end $$;

create function public.signup_restore_entry(p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare e public.signup_entries%rowtype; l public.signup_lists%rowtype;
begin
  perform public.need_role(array['admin']);
  select * into e from public.signup_entries where id = p_id;
  if not found then raise exception 'Entry not found.'; end if;
  if not e.removed then return; end if;
  select * into l from public.signup_lists where id = e.list_id;
  update public.signup_entries
     set removed = false, removed_by = null, removed_at = null, removed_reason = null
   where id = e.id;
  perform public.log_action('signup.restore_entry', 'signup', l.id::text,
    jsonb_build_object('title', l.title, 'person', e.full_name));
end $$;

-- ---------------------------------------------------------------------------
-- Admin: turn an entry into a person (step 1 of Create account) or attach it
-- to an existing person (Merge)
-- ---------------------------------------------------------------------------
create function public.signup_to_person(p_entry uuid, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare e public.signup_entries%rowtype; l public.signup_lists%rowtype; sim jsonb; pid uuid;
begin
  perform public.need_role(array['admin']);
  select * into e from public.signup_entries where id = p_entry for update;
  if not found then raise exception 'Entry not found.'; end if;
  if e.removed then raise exception 'This entry was removed. Restore it first.'; end if;
  if e.person_id is not null then
    return jsonb_build_object('status', 'created', 'id', e.person_id);   -- already linked: reuse
  end if;
  if not p_force then
    select coalesce(jsonb_agg(public._person_card(x.id, null) order by x.score desc), '[]'::jsonb)
      into sim
      from (
        select p.id, similarity(p.full_name, e.full_name) as score
          from public.people p
         where not p.archived and similarity(p.full_name, e.full_name) >= 0.5
         order by similarity(p.full_name, e.full_name) desc limit 5
      ) x;
    if jsonb_array_length(sim) > 0 then
      return jsonb_build_object('status', 'similar', 'matches', sim);
    end if;
  end if;
  insert into public.people (title_id, title_specify, full_name, area_id, district_group_id,
                             voice_part_id, contact, created_by)
  values (e.title_id, e.title_specify, e.full_name, e.area_id, e.district_group_id,
          e.voice_part_id, e.contact, auth.uid())
  returning id into pid;
  update public.signup_entries set person_id = pid, linked_at = now() where id = e.id;
  select * into l from public.signup_lists where id = e.list_id;
  perform public.log_action('signup.convert', 'person', pid::text,
    jsonb_build_object('list', l.title, 'person', e.full_name));
  return jsonb_build_object('status', 'created', 'id', pid);
end $$;

create function public.signup_merge_into(p_entry uuid, p_person uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare e public.signup_entries%rowtype; l public.signup_lists%rowtype; p public.people%rowtype;
begin
  perform public.need_role(array['admin']);
  select * into e from public.signup_entries where id = p_entry for update;
  if not found then raise exception 'Entry not found.'; end if;
  if e.removed then raise exception 'This entry was removed. Restore it first.'; end if;
  select * into p from public.people where id = p_person and not archived;
  if not found then raise exception 'Person not found.'; end if;
  select * into l from public.signup_lists where id = e.list_id;
  update public.signup_entries set person_id = p.id, linked_at = now() where id = e.id;
  perform public.log_action('signup.merge', 'person', p.id::text,
    jsonb_build_object('list', l.title, 'entry', e.full_name, 'person', p.full_name));
end $$;
