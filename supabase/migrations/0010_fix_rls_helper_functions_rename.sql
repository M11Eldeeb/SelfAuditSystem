-- Fixes a critical bug discovered while verifying migration 0009: when this
-- app's tables were renamed with the "self_audit_" prefix (to share one
-- Supabase project across multiple apps), current_user_role() and
-- current_user_branch_id() were left referencing the old "users" table name
-- literally in their SQL body. Table renames update foreign keys, indexes,
-- and RLS policies automatically (they're tracked by OID) - but a function's
-- SQL text is not rewritten by a rename, so both functions silently started
-- returning nothing once "users" no longer existed. Since nearly every RLS
-- policy in this app depends on one of these two functions, this broke
-- officer-only and branch-scoped access across the entire live app (not just
-- Internal Audit) - not with a visible error, but as silently empty results,
-- e.g. officers seeing "No branches yet." despite real data existing.
--
-- Applied directly via the Supabase MCP on 2026-08-31 and verified live
-- (an officer test login went from seeing zero branches to seeing all of
-- them); this migration file exists so the fix is captured in repo history
-- and would be reproducible on a fresh database.

create or replace function public.current_user_role() returns user_role
language sql stable security definer set search_path to 'public'
as $$
  select role from self_audit_users where id = auth.uid();
$$;

create or replace function public.current_user_branch_id() returns uuid
language sql stable security definer set search_path to 'public'
as $$
  select branch_id from self_audit_users where id = auth.uid();
$$;
