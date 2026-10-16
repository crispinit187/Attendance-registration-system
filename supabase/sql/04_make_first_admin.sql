-- ============================================================================
-- Make your first admin. Run ONCE, after steps 1-3.
--
-- 1. In Supabase: Authentication > Users > Add user > Create new user.
--    Enter your email and a temporary password. Tick "Auto Confirm User".
-- 2. Replace YOUR_EMAIL_HERE below with that email, then run this file.
-- 3. Sign in to the website with the temporary password. You will be asked to
--    choose a new password straight away.
-- ============================================================================
update public.accounts
   set role = 'admin',
       must_set_password = true,
       full_name = coalesce(nullif(full_name, ''), 'Admin')
 where lower(email) = lower('crispinlibimbajr@gmail.com');

-- Check it worked: this should show one row with role = admin
select id, email, role, must_set_password from public.accounts where role = 'admin';
