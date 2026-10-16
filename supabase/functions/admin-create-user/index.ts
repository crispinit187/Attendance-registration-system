// Edge Function: admin-create-user
// Lets a signed-in ADMIN invite someone (reviewer, registrar, member or admin).
// It needs the service role key, which Supabase provides to the function
// automatically. The key never reaches the browser.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const ROLES = ['admin', 'reviewer', 'registrar', 'member'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const auth = req.headers.get('Authorization') ?? '';
    if (!auth.startsWith('Bearer ')) return json({ error: 'Please sign in.' }, 401);

    // 1. Who is calling?
    const caller = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: u, error: uerr } = await caller.auth.getUser();
    if (uerr || !u.user) return json({ error: 'Please sign in again.' }, 401);

    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

    // 2. Are they an active admin? (checked in the database, not in the token)
    const { data: me } = await admin.from('accounts').select('role, disabled').eq('id', u.user.id).maybeSingle();
    if (!me || me.role !== 'admin' || me.disabled) return json({ error: 'Only admins can create accounts.' }, 403);

    // 3. Check the request
    const body = await req.json().catch(() => ({}));
    const email = String(body.email ?? '').trim().toLowerCase();
    const fullName = String(body.full_name ?? '').trim();
    const role = String(body.role ?? '');
    const personId = body.person_id ? String(body.person_id) : null;
    if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: 'Please enter a valid email address.' }, 400);
    if (fullName.length < 2) return json({ error: 'Please enter their name.' }, 400);
    if (!ROLES.includes(role)) return json({ error: 'Unknown role.' }, 400);

    if (personId) {
      const { data: p } = await admin.from('people').select('id').eq('id', personId).maybeSingle();
      if (!p) return json({ error: 'That person was not found.' }, 400);
      const { data: taken } = await admin.from('accounts').select('id').eq('person_id', personId).maybeSingle();
      if (taken) return json({ error: 'That person already has an account.' }, 400);
    }

    // 4. Send the invitation email (uses the "Invite user" template)
    const { data: inv, error: ierr } = await admin.auth.admin.inviteUserByEmail(email, { data: { full_name: fullName } });
    if (ierr || !inv.user) {
      const m = ierr?.message ?? 'Could not send the invitation.';
      return json({ error: /already|registered|exists/i.test(m) ? 'Someone with that email already has an account.' : m }, 400);
    }

    // 5. Set role (stored in the accounts table, never in user-editable metadata)
    const { error: aerr } = await admin.from('accounts').update({
      role, full_name: fullName, must_set_password: true, person_id: personId, created_by: u.user.id,
    }).eq('id', inv.user.id);
    if (aerr) {
      await admin.auth.admin.deleteUser(inv.user.id);
      return json({ error: 'Could not finish creating the account. Nothing was saved.' }, 500);
    }
    await admin.auth.admin.updateUserById(inv.user.id, { app_metadata: { role } });

    // 6. Write to the audit log
    await admin.from('audit_log').insert({
      actor_id: u.user.id, actor_name: u.user.email, action: 'account.create', target_type: 'account',
      target_id: inv.user.id, details: { email, role, linked_person: personId },
    });

    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
});
