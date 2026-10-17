# Attendance Registration System

React website (hosted free on GitHub Pages) + Supabase (database, login, live updates, one small server function).

Roles: **member** (scans a QR to mark themselves), **registrar** (registers people at the venue, including people with no phone), **reviewer** (reports and exports for the events/lists an admin grants), **admin** (everything).

> Never put the Supabase **service_role key**, the **database password** or the **Gmail app password** in the code, in GitHub or in chat. The website only ever uses the public **anon** key.

---

## 1. Create the Supabase project
1. supabase.com → **New project**. Choose a name, a strong database password (save it in a password manager, you will not need it again) and the region closest to your users.
2. Wait about two minutes until it says the project is ready.

## 2. Create the database
In Supabase open **SQL Editor → New query**. Paste the whole contents of each file, **in this order**, and press **Run** after each one (each should say “Success”):

1. `supabase/sql/01_tables.sql`
2. `supabase/sql/02_functions.sql`
3. `supabase/sql/03_security_and_seed.sql`

Already running an older database? Instead run the newer files you have not run yet, in order: `05_event_and_entry_delete.sql`, `06_event_archive.sql`, `07_signup_rotating_qr.sql`, `08_member_undo.sql`, `09_account_status.sql`, `10_realtime.sql`. (A fresh install does not need them; 01 to 03 already include everything.)

## 3. Login settings (Authentication)
- **URL Configuration**: Site URL = your final website address **without a trailing slash**, e.g. `https://YOURNAME.github.io/attendance-registration`. Add the same address (and `http://localhost:5173` for local testing) to **Redirect URLs**.
- **Sign In / Providers → Email**: keep *Confirm email* **on**. Minimum password length 8.
- **Emails → Templates**: for each of **Confirm signup**, **Invite user**, **Reset password** paste the matching file from `supabase/email-templates/` (HTML body). Subjects: “Confirm your email”, “You have been invited”, “Reset your password”.
- **Emails → SMTP Settings** (Gmail): turn on custom SMTP. Host `smtp.gmail.com`, port `465`, username = your Gmail address, password = a Google **App password** (Google Account → Security → 2-Step Verification → App passwords). Type it only into this Supabase screen. Sender = the same Gmail address.
  Gmail allows roughly 500 emails a day, which is plenty for sign-ups. Supabase's built-in sender is limited to a few emails an hour, so do set up SMTP before inviting people.
- **Sign In / Providers → Allow anonymous sign-ins**: turn **on**. The public sign-up page uses a hidden, temporary visitor session (no account, no password) so the database can rate-limit it. Keep the Turnstile check on as well.
- **Rate Limits**: raise **Anonymous sign-ins** (default 30 per hour per IP) to about 300, because a whole congregation may sign up from one venue network. Leave the rest at defaults.
- **Attack protection → CAPTCHA** (the “human check”): choose **Cloudflare Turnstile**. At dash.cloudflare.com → Turnstile → *Add widget* (domains: your GitHub Pages host and `localhost`), then paste the **secret key** into Supabase and keep the **site key** for step 7. This is free and shows no puzzles to normal users.

## 4. Deploy the invite function
This lets an admin create reviewer/registrar/admin accounts by email. It needs the Supabase CLI on your computer (one time):

```
npm install -g supabase
supabase login
supabase link --project-ref YOUR-PROJECT-REF
supabase functions deploy admin-create-user
```
(The project ref is the code in your project URL.) The function reads its secret key from Supabase itself; you do not enter any key.

## 5. Create the first admin
1. **Authentication → Users → Add user → Create new user**: your email and a temporary password, tick **Auto Confirm User**.
2. Open `supabase/sql/04_make_first_admin.sql`, replace `YOUR_EMAIL_HERE` with that email, paste it into the SQL Editor and Run. It should show one row with role `admin`.
3. On first sign-in the site asks you to choose your own password.

## 6. Live updates
Step 2 (`03_security_and_seed.sql`) already switches on live updates for the tables the screens watch (attendance, sign-ups, lists, events, people, accounts, audit log). If you ran an older version, run `10_realtime.sql` once. Screens refresh by themselves; timers are only a backup.

## 7. Put the site on GitHub Pages
1. Create a GitHub repository and push this folder to it (`.env` files are ignored by `.gitignore`).
2. Repo **Settings → Pages → Source: GitHub Actions**.
3. Repo **Settings → Secrets and variables → Actions → Variables** → add three **variables** (they are public values):
   - `VITE_SUPABASE_URL` (Supabase → Project Settings → API → Project URL)
   - `VITE_SUPABASE_ANON_KEY` (same page → the **anon / public** key. *Not* the service_role key)
   - `VITE_TURNSTILE_SITE_KEY` (the Cloudflare site key; leave empty to hide the human check)
4. Push to `main`. The workflow in `.github/workflows/deploy.yml` builds and publishes. The address appears under Settings → Pages.

## Working on it locally
```
copy .env.example .env.local     (then fill the three values)
npm install
npm run dev
```
`npm run build` type-checks and builds.

## How it behaves (quick reference)
- **One open list at a time**, enforced by the database. Opening a second one is refused with the name of the one that is open.
- **QR codes**: static (downloadable PNG from the list page) or **rotating** (shown live on the venue screen; photos of it stop working). Optional **location check** (default 200 m, set per list) and **area limits** per list.
- **Details at the time**: every attendance record stores a copy of the person's details, so editing a profile never changes history.
- **Removing** someone from a list (admin or registrar) and **archive → delete** of lists always ask for confirmation and are written to the **audit log**, as is every export.
- **Districts** are free text; similar spellings are grouped automatically (Lusaka East and Lusaka West are never mixed up). Admins can rename or merge groups.
- **Sign-up lists** (Sign-ups in the menu) are separate from attendance lists. An admin makes a list, picks which voice parts are offered (optional area limits and location check), and opens it. The public scans the QR code or opens the shared link (`#/join/<code>`), types title, name, area, district, voice part and optional contact, and needs no account. One switch opens or closes sign-ups (admin only, logged); a closed list shows "Sign-ups are closed" on the same link. Only one sign-up list is open at a time, independent of attendance lists. A sign-up list can optionally use a **rotating QR code** (admin sets the seconds, default 30): it is shown live on a venue screen (Show on screen), the screen shows no countdown or timing text, a photo stops working once the code moves on, and the shared link is not available for that list. A visitor who has opened the page can take up to about 10 minutes to fill the form.
- **Sign-up duplicates**: names are compared ignoring case, punctuation, titles and word order. Same name in the same district (or either district blank) is "already signed up" and blocked; a very similar name or the same name in another district asks "That is me / I am a different person". Staff can force an entry, which gets a "possible duplicate" badge.
- **Paste a list** (admin and registrar): one person per line, optional district, voice part, area and phone after the name; a preview flags duplicates before anything is saved. Staff can still paste or add while sign-ups are closed.
- **Entries** stay in their own section. Admin can **Create account** (adds the person and sends an invite) or **Merge into existing person**. Registrars see only the open list, never contact numbers, and can edit or remove only entries they added.
- **Link sharing**: Copy link / Share, or **Make a new link** (the old link and printed QR stop working). The link has exactly the same protections as the QR code, including the location check. Attendance lists also get a Copy link for static QR codes (not rotating ones).
- Members created by a registrar have no account. When an admin later creates an account for them (Accounts → Create account → Member → link person) all their records connect.

## Security notes
- Real protection is in the database (Row Level Security + functions). The website cannot do anything the signed-in role is not allowed to.
- Roles live in the `accounts` table, not in anything a user can edit.
- Sign-in, sign-up and password reset are protected by the Turnstile check and Supabase rate limits; marking attendance and searching are rate limited inside the database.
- Supabase free projects pause after about a week of no activity; opening the site (or the dashboard) wakes them.
