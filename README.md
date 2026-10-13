# Hospital Management System (educational prototype)

Static site (HTML/CSS/JS) + Supabase (database + auth) + Vercel (hosting). Use fictional data only.

## 1. Create a Supabase project
1. Sign up at https://supabase.com and click **New project**.
2. Choose a name, a region near you, and a strong database password (save it somewhere private; it is never used in this app).
3. Wait until the project finishes setting up.

## 2. Run the schema
1. Open **SQL Editor** > **New query**.
2. Paste the full contents of `supabase-schema.sql` and click **Run**.
3. Check **Table Editor**: you should see `profiles`, `patients`, `doctors`, `appointments`.

## 3. Authentication settings
1. **Authentication > Sign In / Providers**: make sure **Email** is enabled.
2. Turn **off** "Allow new users to sign up" so strangers cannot create accounts. (RLS would block them anyway; this is extra safety.)
3. **Authentication > URL Configuration**:
   - Site URL: `http://127.0.0.1:5500` (Live Server default; change later to your Vercel URL).
   - Redirect URLs: add `http://127.0.0.1:5500/**` and `http://localhost:5500/**`.

(Menu names can differ slightly between Supabase versions.)

## 4. Create the first administrator
1. **Authentication > Users > Add user > Create new user**.
2. Enter an email and password, tick **Auto Confirm User**, and create it.
3. In **SQL Editor**, run (use your email and name):
```sql
   insert into public.profiles (id, full_name, role)
   select id, 'Admin Name', 'admin' from auth.users where email = 'admin@example.com';
```
4. For more staff, repeat with role `'staff'`.

Why it is safe: browser users have no write access to `profiles`, so nobody can give themselves a role. Only the dashboard/SQL Editor can.

## 5. Add your keys to `config.js`
Go to **Project Settings > API** (or **API Keys**) and copy:
- **Project URL** into `SUPABASE_URL`
- **Publishable key** (`sb_publishable_...`, or the legacy `anon` key) into `SUPABASE_KEY`

Never use the `service_role` / secret key or your database password in the code.

## 6. Run locally
1. Open the folder in VS Code and install the **Live Server** extension.
2. Right-click `index.html` > **Open with Live Server**.
3. Sign in with the admin account. Add a patient, then a doctor (3 sample doctors already exist), then book an appointment.

## 7. Upload to GitHub
```bash
cd hospital-management-system
git init
git add .
git commit -m "Hospital management system"
git branch -M main
git remote add origin https://github.com/<your-username>/hospital-management-system.git
git push -u origin main
```
(Create the empty repo on github.com first. Committing `config.js` is fine: it holds only the public URL and publishable key.)

## 8. Deploy to Vercel
1. Sign in at https://vercel.com with GitHub.
2. **Add New > Project**, import the repository.
3. Framework Preset: **Other**. Leave build command and output directory empty.
4. Click **Deploy** and copy your URL (e.g. `https://your-app.vercel.app`).

## 9. Production URLs in Supabase
**Authentication > URL Configuration**: set Site URL to your Vercel URL and add `https://your-app.vercel.app/**` to Redirect URLs (keep the localhost ones for testing).

## 10. Test the deployed app
- Visiting the URL shows the login page, not the dashboard.
- Wrong password shows an error; the admin login works.
- Add, edit, search and delete a patient and a doctor.
- Book an appointment; try a past date (should be rejected).
- Change status, cancel an appointment; dashboard numbers update.
- Log out, then refresh: you must land on the login page again.