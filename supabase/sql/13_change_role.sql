-- Change an account's role without deleting it. Admins only. Run once in the Supabase SQL Editor,
-- after 01 to 12. Safe to run again.

create or replace function public.change_role(p_id uuid, p_role text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a public.accounts%rowtype; scope text; removed int := 0;
begin
  perform public.need_role(array['admin']);
  if p_role is null or p_role not in ('admin', 'manager', 'reviewer', 'registrar', 'member') then
    raise exception 'Unknown role.';
  end if;
  select * into a from public.accounts where id = p_id for update;
  if not found then raise exception 'Account not found.'; end if;
  if p_id = auth.uid() then raise exception 'You cannot change your own role.'; end if;
  if a.role = p_role then raise exception 'This account already has that role.'; end if;
  if a.role = 'admin' and not exists (select 1 from public.accounts where role = 'admin' and not disabled and id <> p_id) then
    raise exception 'This is the only admin. Make someone else an admin first.';
  end if;

  -- Event managers always work with what is selected. Registrars and reviewers keep the type they had
  -- when moving between staff roles; people coming from admin or member start from the usual default.
  scope := case
             when p_role = 'manager' then 'selected'
             when a.role in ('registrar', 'reviewer', 'manager') and p_role in ('registrar', 'reviewer') then a.access_scope
             when p_role = 'reviewer' then 'selected'
             else 'all'
           end;

  -- Remove access the new role cannot use: everything for admin and member, single lists for a manager,
  -- sign-up lists for a reviewer.
  delete from public.reviewer_grants g
   where g.account_id = p_id
     and (p_role in ('admin', 'member')
          or (p_role = 'manager' and g.list_id is not null)
          or (p_role = 'reviewer' and g.signup_list_id is not null));
  get diagnostics removed = row_count;

  update public.accounts set role = p_role, access_scope = scope where id = p_id;
  perform public.log_action('account.role', 'account', p_id::text,
    jsonb_build_object('email', a.email, 'from', a.role, 'to', p_role, 'access_removed', removed));
  return jsonb_build_object('from', a.role, 'to', p_role, 'access_removed', removed, 'scope', scope);
end $$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'change_role'
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
