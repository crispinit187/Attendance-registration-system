-- Lets a member undo their own mistaken scan (within 2 minutes), as the Undo button promises.
-- Run once in the Supabase SQL Editor. Safe to run again.

create or replace function public.undo_attendance(p_att uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare a public.attendance%rowtype; l public.lists%rowtype;
begin
  perform public.need_role(array['admin', 'registrar', 'member']);
  select * into a from public.attendance where id = p_att;
  if not found then raise exception 'Attendance record not found.'; end if;
  if a.removed then
    raise exception 'This attendee was already removed. Use Restore instead.';
  end if;
  if a.marked_by is distinct from auth.uid() then
    raise exception 'You can only undo a mark that you made.';
  end if;
  if a.marked_at < now() - interval '120 seconds' then
    raise exception 'The quick undo window has passed. Please ask a registrar to remove it.';
  end if;
  select * into l from public.lists where id = a.list_id;
  delete from public.attendance where id = a.id;
  perform public.log_action('attendance.undo', 'list', a.list_id::text,
    jsonb_build_object('list_title', l.title, 'person', a.snapshot->>'display_name'));
end $$;

grant execute on function public.undo_attendance(uuid) to authenticated;
