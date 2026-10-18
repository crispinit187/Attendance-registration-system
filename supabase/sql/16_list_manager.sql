-- List manager, wider scope: besides tracker lists, a list manager can now be given single attendance lists
-- (inside an event) and single sign-up lists. Within those they can open and close, show the QR code,
-- mark people, remove and restore, see contact numbers, export, and turn sign-ups into people.
-- Creating, deleting and editing lists and events, giving access and approving late marks stay with admins
-- (and, for lists, event managers). Run AFTER 15_stage2.sql. Safe to run again.

-- Rewrites existing functions so they accept the list manager too, without copying their code by hand.
create or replace function pg_temp._lm_patch(p_name text, p_pairs text[]) returns void
language plpgsql as $$
declare f record; d text; n text; i int;
begin
  for f in select p.oid from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = p_name loop
    d := pg_get_functiondef(f.oid); n := d;
    i := 1;
    while i < array_length(p_pairs, 1) loop
      n := replace(n, p_pairs[i], p_pairs[i + 1]);
      i := i + 2;
    end loop;
    if n not like '%list_manager%' then raise exception 'Could not extend function %', p_name; end if;
    if n <> d then execute n; end if;
  end loop;
end $$;

do $$
declare nm text;
  generic text[] := array[
    $q$array['admin', 'manager']$q$,                       $q$array['admin', 'manager', 'list_manager']$q$,
    $q$array['admin', 'registrar', 'manager']$q$,           $q$array['admin', 'registrar', 'manager', 'list_manager']$q$,
    $q$r = 'manager'$q$,                                    $q$r in ('manager', 'list_manager')$q$,
    $q$r in ('registrar', 'manager')$q$,                    $q$r in ('registrar', 'manager', 'list_manager')$q$,
    $q$r in ('admin', 'registrar', 'manager')$q$,           $q$r in ('admin', 'registrar', 'manager', 'list_manager')$q$,
    $q$app_role() in ('reviewer', 'manager')$q$,            $q$app_role() in ('reviewer', 'manager', 'list_manager')$q$,
    $q$a.role in ('registrar', 'reviewer', 'manager')$q$,   $q$a.role in ('registrar', 'reviewer', 'manager', 'list_manager')$q$,
    $q$a.role in ('registrar', 'manager')$q$,               $q$a.role in ('registrar', 'manager', 'list_manager')$q$,
    $q$a.role <> 'manager'$q$,                              $q$a.role not in ('manager', 'list_manager')$q$
  ];
begin
  foreach nm in array array[
    'list_access', 'event_access', 'signup_access', 'can_review_list', 'can_review_event',
    'open_list', 'close_list', 'get_qr_payload', 'list_present', 'mark_attendance_manual', 'remove_attendance', 'restore_attendance',
    'search_people', 'create_person', 'get_open_lists',
    'signup_lists_overview', 'signup_get', 'signup_qr_payload', 'signup_set_open', 'signup_entries', 'signup_paste',
    'signup_update_entry', 'signup_remove_entry', 'signup_restore_entry'
  ] loop
    perform pg_temp._lm_patch(nm, generic);
  end loop;

  -- Turning a sign-up entry into a person (or joining it to one): admins, event managers and list managers of that sign-up list
  foreach nm in array array['signup_to_person', 'signup_merge_into'] loop
    perform pg_temp._lm_patch(nm, array[
      $q$perform public.need_role(array['admin']);$q$,
      $q$perform public.need_role(array['admin', 'manager', 'list_manager']);$q$,
      $q$if not found then raise exception 'Entry not found.'; end if;$q$,
      $q$if not found then raise exception 'Entry not found.'; end if;
  if public.app_role() <> 'admin' and not public.signup_access(e.list_id) then raise exception 'You do not have access to this sign-up list.'; end if;$q$
    ]);
  end loop;

  -- Offline marking by registrars (Stage 2) also works for list managers
  perform pg_temp._lm_patch('attendance_sync', array[
    $q$array['admin', 'registrar']$q$, $q$array['admin', 'registrar', 'manager', 'list_manager']$q$,
    $q$r = 'registrar' and not public.list_access(l.id)$q$, $q$r <> 'admin' and not public.list_access(l.id)$q$
  ]);

  -- Changing a role to list manager keeps single attendance and sign-up list access
  perform pg_temp._lm_patch('change_role', array[
    $q$(p_role = 'list_manager' and (g.event_id is not null or g.list_id is not null or g.signup_list_id is not null))$q$,
    $q$(p_role = 'list_manager' and g.event_id is not null)$q$
  ]);
end $$;

-- Event managers and list managers also see removed attendance on their lists, so they can restore it
drop policy if exists attendance_select on public.attendance;
create policy attendance_select on public.attendance for select to authenticated
  using (
    public.app_role() = 'admin'
    or (public.app_role() in ('manager', 'list_manager') and public.can_review_list(list_id))
    or (not removed and public.can_review_list(list_id))
    or (not removed and person_id = public.my_person_id())
  );

-- Admins can give a list manager single attendance lists and sign-up lists
create or replace function public.grant_access(p_account uuid, p_event uuid, p_list uuid, p_signup uuid default null) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare a public.accounts%rowtype;
begin
  perform public.need_role(array['admin']);
  select * into a from public.accounts where id = p_account;
  if not found or a.role not in ('registrar', 'reviewer', 'manager', 'list_manager') then raise exception 'Choose a registrar, reviewer, event manager or list manager account.'; end if;
  if (p_event is not null)::int + (p_list is not null)::int + (p_signup is not null)::int <> 1 then
    raise exception 'Choose one event, list or sign-up list.';
  end if;
  if p_signup is not null and a.role not in ('registrar', 'manager', 'list_manager') then raise exception 'Only registrars, event managers and list managers work with sign-up lists.'; end if;
  if p_list is not null and a.role = 'manager' then raise exception 'Give an event manager a whole event or a sign-up list.'; end if;
  if p_event is not null and a.role = 'list_manager' then raise exception 'Give a list manager one list, not a whole event.'; end if;
  insert into public.reviewer_grants (account_id, event_id, list_id, signup_list_id, created_by)
  values (p_account, p_event, p_list, p_signup, auth.uid())
  on conflict do nothing;
  perform public.log_action('grant.add', 'account', p_account::text,
    jsonb_build_object('email', a.email, 'event_id', p_event, 'list_id', p_list, 'signup_list_id', p_signup));
end $$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = any (array['grant_access', 'list_access', 'event_access', 'signup_access', 'can_review_list', 'can_review_event',
         'open_list', 'close_list', 'get_qr_payload', 'list_present', 'mark_attendance_manual', 'remove_attendance', 'restore_attendance',
         'search_people', 'create_person', 'get_open_lists', 'signup_lists_overview', 'signup_get', 'signup_qr_payload', 'signup_set_open',
         'signup_entries', 'signup_paste', 'signup_update_entry', 'signup_remove_entry', 'signup_restore_entry', 'signup_to_person',
         'signup_merge_into', 'attendance_sync', 'change_role'])
  loop
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
