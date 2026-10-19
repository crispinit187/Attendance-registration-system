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

Already running an older database? Instead run the newer files you have not run yet, in order: `05_event_and_entry_delete.sql`, `06_event_archive.sql`, `07_signup_rotating_qr.sql`, `08_member_undo.sql`, `09_account_status.sql`, `10_realtime.sql`, `11_access_scope.sql`, `12_event_manager.sql`, `13_change_role.sql`. (A fresh install does not need them; 01 to 03 already include everything.)

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

## Access types and open lists

Registrars and reviewers each have an access type, set by the admin on the Accounts page (the three dots on a row, then Access):

- **All events and lists**: everything, including future ones (and every sign-up list for registrars).
- **Only what I select**: just the events, lists and, for registrars, sign-up lists the admin adds. Access can be added or removed at any time.

Several attendance lists and several sign-up lists can be open at the same time. If you run an older database, run `11_access_scope.sql` once and redeploy the function: `npx supabase functions deploy admin-create-user`.

## Event managers

An event manager is a fourth kind of staff account, for people who run some events and sign-up lists. Only an admin creates them and chooses what each one can work with (Accounts, the ⋯ menu on their row, Access and permissions: whole events and sign-up lists).

Inside what they were given, an event manager can create and edit lists, open and close registration, archive and delete lists, create and manage sign-up lists, mark and remove attendance, add people, see contact numbers and export to Excel or PDF. They cannot create events, and they have no Accounts, People, Setup, Districts or Audit log pages. They cannot give anyone access.

Each event and sign-up list shows "Managed by" with its event manager, plus the registrars and reviewers who were given it. Only an admin can change that team (Manage team on the event or sign-up list).

If you run an older database, run `12_event_manager.sql` once and redeploy the function: `npx supabase functions deploy admin-create-user`.

## Changing a role

An admin can switch an existing account to another role (Accounts, the ⋯ menu on the row, Change role). The sign-in, history and details stay. Access that still fits the new role is kept; the rest is removed, and the dialog says what will happen first. You cannot change your own role. Run `13_change_role.sql` once on an existing database.

## Trackers (Stage 1)
A separate **Trackers** section for events where people are ticked against dates without needing accounts. A tracker event holds lists (for example East, West, South, North); each list is a grid of people with a column per date.

**Setting up an existing system**
1. Run `supabase/sql/14_trackers.sql` once in the Supabase SQL Editor (it can safely be run twice). A brand new project runs 01, 02, 03, then 14.
2. Redeploy the invite function (it now knows the *list manager* role): `npx supabase functions deploy admin-create-user`.
3. Run `npm install` (new package `read-excel-file`, used for .xlsx import), then rebuild and push as usual.

**Roles**
- *List manager* (new): works with the tracker lists an admin gives them; adds date columns, imports spreadsheets, ticks people, removes and restores people, sees phone numbers.
- Event managers can be given tracker events. Registrars tick and add people; reviewers view only. Registrars and reviewers never see phone numbers.
- Give access from Accounts → Access and permissions, or from a tracker event's *Manage team* box.

**Spreadsheet import** (list or whole event): choose a .xlsx or .csv, match the columns, match unknown voice spellings (remembered afterwards), review new districts and congregations, preview, then Import. Imported people are saved in People. Nothing is merged automatically; look-alikes appear in **People → Possible duplicates**.

**Also new**: Congregations page (same spelling-matching as districts), optional Title, Events pages now show events first with lists, team and analytics inside each event, and a PDF analytics report for both attendance and tracker events.

## Stage 2: offline, undo, history, follow-up, search
**Setting up an existing system**: run `supabase/sql/15_stage2.sql` once in the Supabase SQL Editor (safe to run twice; a new project runs 01, 02, 03, 14, 15), then rebuild and push. No new packages. The app now has a manifest and a service worker, so it can be installed to a phone's home screen.

- **Working offline.** Open a tracker list or the registrar page while online once; it is remembered on that device. With no connection, ticks and registrar marks are saved on the device, shown in a banner, and sent automatically when the connection returns (or with *Send now*). Each mark carries its own id, so sending twice never records twice. Offline marking works for lists already opened and, for registrars, people already found by search. Adding brand-new people needs a connection.
- **Late marks.** A registrar mark made offline counts if it was made while the list was open (2 minutes of clock tolerance). One made before it opened or after it closed waits on the admin dashboard under *Late marks*, to approve or reject. Tracker ticks have no open window, so they always count and keep the time they were made.
- **My recent actions** (clock button in the header, for admins, managers, list managers and registrars): the last 3 days of what you did, with Undo for 24 hours (ticks, registrations, marks). Undo of a mark keeps the record as removed, and every undo is in the audit log.
- **Attendance history** per person: People → History (events and trackers).
- **Absent follow-up**: on a tracker list, *Absent* shows who missed a date (or the last 3), with Call and WhatsApp links for people who can see phone numbers, copy and CSV download.
- **Audit log** now searches by name, action or detail text, with a type filter and date range.
- **Search anywhere**: Ctrl+K (Cmd+K on Mac) or the magnifier in the header.

## List managers (single lists)

Run `supabase/sql/16_list_manager.sql` after `15_stage2.sql`. A list manager can now be given tracker lists, **one attendance list** (not a whole event) and sign-up lists, from Accounts → Access and permissions. On those lists they can open and close, show the QR and venue screen, mark people, remove and restore attendees, see phone numbers, export, and for sign-ups paste/review entries and turn them into people. They cannot create, edit or delete lists or events, give access, or approve late marks (admin only). Event managers can now also turn sign-up entries into people.

## Open and close dates (tracker)

Run `supabase/sql/17_open_close_dates.sql` after `16_list_manager.sql`. Every tracker date column is **closed** until an admin, event manager or list manager opens it (tap "Closed" under the date). Only open columns can be ticked or unticked, so nobody can back-date a tick. Several columns can be open at once. An admin can still tick a closed column; it is shown as an override and logged. A tick made offline while a column was open is accepted when it syncs later (judged by the time it was made); one made while closed is refused and listed as held. Importing into a closed column stays allowed for admins, event managers and list managers. Existing columns become closed when you run the SQL.
