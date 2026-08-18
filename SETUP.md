# Setup

This app needs a Supabase project (free tier). An Anthropic API key is **optional** — see
step 3. I can't create accounts on your behalf, so these steps are for you to run.

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com), create a free account/project (any region).
2. In **Project Settings → API**, copy:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` `public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key (Project Settings → API → reveal) → `SUPABASE_SERVICE_ROLE_KEY` (keep this secret, server-only)

## 2. Run the database migrations

In the Supabase dashboard, open **SQL Editor**, and run these two files in order (copy/paste each, click Run):

1. [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) — tables, RLS policies, storage bucket
2. [`supabase/migrations/0002_seed_questions.sql`](supabase/migrations/0002_seed_questions.sql) — seeds the 18 audit questions + 4 photo types from the schema you provided

## 3. (Optional, costs money) Get an Anthropic API key

Skip this entirely if you don't want to spend anything. Without a key, the app still does
everything: claims upload, cycle generation, the full self-audit form, and officer review —
officers just judge every question manually instead of seeing an AI-suggested answer first.
Nothing breaks and nothing in the app requires this key to work.

If you do want the AI-assisted checks later:

1. Go to [console.anthropic.com](https://console.anthropic.com), create an account.
   New accounts get a one-time **$5 free trial credit** (no card needed, phone verification
   required) — worth roughly 1,000+ submitted-claim checks, but it **expires 14 days** after
   you claim it, so only claim it once you're ready to actually test AI checks, not in advance.
2. Create an API key → `ANTHROPIC_API_KEY`.
3. Beyond the free trial, AI checks cost roughly a few cents per submitted claim (one Claude
   call per claim, with up to 4 photos attached). Everything else in this stack is free at
   this scale regardless.

You can also add this later — just leave `ANTHROPIC_API_KEY` blank for now and fill it in
(in `.env.local` and in Vercel) whenever you're ready; no code changes needed either way.

## 4. Configure environment variables

Copy `.env.local.example` to `.env.local` and fill in the three Supabase values from step 1
(and `ANTHROPIC_API_KEY` too, only if you did step 3):

```bash
cp .env.local.example .env.local
```

## 5. Create the first officer account

There's no self-signup (by design — officers create accounts for everyone), so the very
first officer account has to be created manually:

1. In Supabase dashboard → **Authentication → Users → Add user**, create a user with your
   email and a password. Enable "Auto Confirm User".
2. In **SQL Editor**, run (replace the email and pick a name):

   ```sql
   insert into public.users (id, email, full_name, role)
   select id, email, 'Your Name', 'officer'
   from auth.users
   where email = 'you@example.com';
   ```

3. Log in at `/login` with that email/password. From there, use **Branches & Users** in
   the app to add branches and create branch admin / other officer accounts normally —
   the app generates a temporary password for each new account for you to share.

## 6. Run it locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## 7. Deploy (free)

1. Push this repo to GitHub.
2. Go to [vercel.com](https://vercel.com), import the repo (Hobby/free plan).
3. Add the environment variables from `.env.local` in the Vercel project settings
   (`ANTHROPIC_API_KEY` only if you're using it).
4. Deploy. Vercel gives you a `*.vercel.app` URL branches can use from anywhere.

## Monthly workflow

1. **Upload claims** (Admin → Claims): upload last month's claims export (.xlsx/.csv).
2. **Generate cycle** (Admin → Audit Cycles): pick the audit month; it randomly assigns
   up to 10 claims per branch from the previous month's claims.
3. **Branch admins** log in, answer the 18 questions and upload the 4 required photos
   per assigned claim, and submit.
4. If `ANTHROPIC_API_KEY` is set, AI checks run automatically on submission for the
   AI-checkable questions. If not, this step is simply skipped.
5. **Officers** review each claim (Admin → Review): confirming/overriding the AI's
   suggestions where present, or just judging every question manually if you're not using
   AI, then finalize each branch's results.
6. **Results** (Admin → Results, or the branch admin's own dashboard) show the finalized
   score per branch per month.
