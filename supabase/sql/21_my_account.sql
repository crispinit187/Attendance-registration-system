-- 21: "My account": staff and admins can edit their own name and phone, and the account email stays in step
-- with the verified email in Supabase Auth. Safe to run more than once.

alter table public.accounts add column if not exists phone text;

create or replace function public.update_my_account(p_name text, p_phone text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare nm text := btrim(coalesce(p_name, '')); ph text := nullif(btrim(coalesce(p_phone, '')), '');
begin
  if auth.uid() is null then raise exception 'Not signed in.' using errcode = 'P0001'; end if;
  perform public.rate_check('update_my_account', 20, 3600);
  if char_length(nm) < 2 or char_length(nm) > 120 then raise exception 'Please enter your full name.' using errcode = 'P0001'; end if;
  if ph is not null and (char_length(ph) > 30 or ph !~ '^[0-9+()\- ]+$') then raise exception 'Enter a valid phone number.' using errcode = 'P0001'; end if;
  update public.accounts set full_name = nm, phone = ph where id = auth.uid();
  perform public.log_action('account_update', 'account', auth.uid()::text, jsonb_build_object('name', nm, 'phone_set', ph is not null));
end $$;
revoke all on function public.update_my_account(text, text) from public, anon;
grant execute on function public.update_my_account(text, text) to authenticated;

-- When Supabase Auth finishes an email change (the new address was verified), copy it across.
create or replace function public.sync_account_email() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is distinct from old.email then
    update public.accounts set email = new.email where id = new.id;
    insert into public.audit_log (actor_id, actor_name, action, target_type, target_id, details)
    values (new.id, new.email, 'email_changed', 'account', new.id::text, jsonb_build_object('from', old.email, 'to', new.email));
  end if;
  return new;
end $$;
drop trigger if exists on_auth_email_changed on auth.users;
create trigger on_auth_email_changed after update of email on auth.users
  for each row execute function public.sync_account_email();
