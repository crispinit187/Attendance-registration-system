-- RUN THIS ONCE in the Supabase SQL Editor if your database was created before this file existed.
-- (Fresh installs already get these functions from 02 and 03.)
-- ---------------------------------------------------------------------------
-- Delete an EMPTY event, and permanently delete a sign-up entry that was already removed
-- ---------------------------------------------------------------------------
-- Admin only. An event can only be deleted when it has no lists at all (archived ones count),
-- and its exact name must be typed. Any reviewer access given for the whole event goes with it.
create or replace function public.delete_event(p_id uuid, p_confirm text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare ev public.events%rowtype; n int;
begin
  perform public.need_role(array['admin']);
  select * into ev from public.events where id = p_id for update;
  if not found then raise exception 'Event not found.'; end if;
  select count(*) into n from public.lists where event_id = p_id;
  if n > 0 then
    raise exception 'This event still has % list(s). Delete them first (archive, then delete).', n;
  end if;
  if btrim(coalesce(p_confirm, '')) <> ev.name then
    raise exception 'The typed name does not match. Nothing was deleted.';
  end if;
  delete from public.events where id = p_id;
  perform public.log_action('event.delete', 'event', p_id::text, jsonb_build_object('name', ev.name));
end $$;

-- Admin only, and only for an entry that was removed first. The audit log records that an
-- entry was deleted from which list, but not the person's name or details.
create or replace function public.signup_delete_entry(p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare e public.signup_entries%rowtype; l public.signup_lists%rowtype;
begin
  perform public.need_role(array['admin']);
  perform public.rate_check('signup_remove', 60, 60);
  select * into e from public.signup_entries where id = p_id for update;
  if not found then raise exception 'Entry not found.'; end if;
  if not e.removed then raise exception 'Remove this entry first, then delete it permanently.'; end if;
  select * into l from public.signup_lists where id = e.list_id;
  delete from public.signup_entries where id = e.id;
  perform public.log_action('signup.delete_entry', 'signup', l.id::text, jsonb_build_object('title', l.title));
end $$;

-- Let signed-in users call them (the functions themselves check for admin).
grant execute on function public.delete_event(uuid, text) to authenticated;
grant execute on function public.signup_delete_entry(uuid) to authenticated;
grant execute on function public.delete_event(uuid, text) to service_role;
grant execute on function public.signup_delete_entry(uuid) to service_role;
