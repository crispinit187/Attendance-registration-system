-- RUN THIS ONCE in the Supabase SQL Editor (after 06_event_archive.sql).
-- Adds the optional ROTATING QR code for sign-up lists.
-- Fresh installs already get all of this from 01, 02 and 03.

alter table public.signup_lists add column if not exists rotating_qr boolean not null default false;
alter table public.signup_lists add column if not exists rotation_seconds int not null default 30
  check (rotation_seconds between 10 and 600);
alter table public.signup_lists add column if not exists rotation_secret text not null
  default encode(extensions.gen_random_bytes(16), 'hex');

-- signup_save gets two more inputs, so the old version is replaced
drop function if exists public.signup_save(uuid, text, uuid[], uuid[], boolean, double precision, double precision, int);

create or replace function public._signup_resolve(p_code text) returns public.signup_lists
language plpgsql security definer set search_path = public, extensions as $$
declare
  c text := btrim(coalesce(p_code, ''));
  l public.signup_lists%rowtype;
  base text; tail text; w bigint; nw bigint; ex bigint; mac text; good boolean := false;
begin
  base := split_part(split_part(c, '!', 1), '.', 1);
  select * into l from public.signup_lists where code = base;
  if not found then
    raise exception 'This link is not valid. Please ask for the current link or QR code.';
  end if;
  if not l.rotating_qr then
    if c <> base then raise exception 'This link is not valid. Please ask for the current link or QR code.'; end if;
    return l;
  end if;
  if c = base then
    raise exception 'Please scan the QR code shown on the screen to sign up.';
  end if;
  begin
    if position('!' in c) > 0 then
      tail := split_part(c, '!', 2);
      ex  := split_part(tail, '.', 1)::bigint;
      mac := split_part(tail, '.', 2);
      good := ex >= extract(epoch from now())::bigint
              and mac = substr(encode(extensions.hmac('t' || ex::text, l.rotation_secret, 'sha256'), 'hex'), 1, 16);
    else
      tail := substr(c, char_length(base) + 2);
      w   := split_part(tail, '.', 1)::bigint;
      mac := split_part(tail, '.', 2);
      nw  := floor(extract(epoch from now()) / l.rotation_seconds)::bigint;
      good := w between nw - 1 and nw and mac = public.rot_code(l.rotation_secret, w);
    end if;
  exception when others then
    good := false;
  end;
  if not good then
    raise exception 'This QR code has expired. Please scan the screen again.';
  end if;
  return l;
end $$;

create or replace function public._signup_ticket(l public.signup_lists) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare ex bigint := extract(epoch from now())::bigint + 600;
begin
  return l.code || '!' || ex::text || '.' ||
         substr(encode(extensions.hmac('t' || ex::text, l.rotation_secret, 'sha256'), 'hex'), 1, 16);
end $$;

create or replace function public.signup_public_info(p_code text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare l public.signup_lists%rowtype; ip text;
begin
  ip := public._client_ip();
  if ip <> 'unknown' then perform public.rate_check_key('signup_info:' || ip, 120, 600); end if;
  l := public._signup_resolve(p_code);
  return jsonb_build_object(
    'ticket', case when l.rotating_qr then public._signup_ticket(l) else null end,
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

create or replace function public.signup_submit(
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

  l := public._signup_resolve(p_code);
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

create or replace function public.signup_get(p_id uuid) returns jsonb
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
    'rotating_qr', l.rotating_qr, 'rotation_seconds', l.rotation_seconds,
    'entries', (select count(*) from public.signup_entries e where e.list_id = l.id and not e.removed));
end $$;

create or replace function public.signup_qr_payload(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r text; l public.signup_lists%rowtype; w bigint; secs int;
begin
  r := public.need_role(array['admin', 'registrar']);
  perform public.rate_check('qr', 120, 60);
  select * into l from public.signup_lists where id = p_id;
  if not found then raise exception 'Sign-up list not found.'; end if;
  if r = 'registrar' and l.status <> 'open' then
    raise exception 'You can only see the sign-up list that is open now.';
  end if;
  if not l.rotating_qr then raise exception 'This sign-up list uses a fixed QR code, not a rotating one.'; end if;
  if l.status <> 'open' then raise exception 'Sign-ups are closed. Open them to show the QR code.'; end if;
  w := floor(extract(epoch from now()) / l.rotation_seconds)::bigint;
  secs := l.rotation_seconds - (extract(epoch from now())::bigint % l.rotation_seconds)::int;
  return jsonb_build_object(
    'code', l.code || '.' || w::text || '.' || public.rot_code(l.rotation_secret, w),
    'seconds_left', secs, 'rotation_seconds', l.rotation_seconds, 'title', l.title,
    'entries', (select count(*) from public.signup_entries e where e.list_id = l.id and not e.removed));
end $$;

create or replace function public.signup_save(
  p_id uuid, p_title text, p_voices uuid[], p_areas uuid[],
  p_location boolean, p_lat double precision, p_lng double precision, p_radius int,
  p_rotating boolean default false, p_rotation int default 30
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
  if coalesce(p_rotation, 30) not between 10 and 600 then
    raise exception 'The code can change every 10 to 600 seconds.';
  end if;
  if p_id is null then
    insert into public.signup_lists (title, voice_part_ids, allowed_area_ids, location_check,
                                     venue_lat, venue_lng, radius_m, rotating_qr, rotation_seconds, created_by)
    values (btrim(p_title), vs, ar, p_location, p_lat, p_lng, coalesce(p_radius, 200),
            coalesce(p_rotating, false), coalesce(p_rotation, 30), auth.uid())
    returning id into lid;
    perform public.log_action('signup.create', 'signup', lid::text, jsonb_build_object('title', btrim(p_title)));
  else
    update public.signup_lists
       set title = btrim(p_title), voice_part_ids = vs, allowed_area_ids = ar,
           location_check = p_location, venue_lat = p_lat, venue_lng = p_lng,
           radius_m = coalesce(p_radius, 200),
           rotating_qr = coalesce(p_rotating, false), rotation_seconds = coalesce(p_rotation, 30)
     where id = p_id
     returning id into lid;
    if lid is null then raise exception 'Sign-up list not found.'; end if;
  end if;
  return lid;
end $$;

grant execute on function public.signup_qr_payload(uuid) to authenticated, service_role;
grant execute on function public.signup_save(uuid, text, uuid[], uuid[], boolean, double precision, double precision, int, boolean, int)
  to authenticated, service_role;
-- the public page still reads its form before sign-in
grant execute on function public.signup_public_info(text) to anon;
