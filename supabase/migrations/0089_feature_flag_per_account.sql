-- A feature flag can now also be switched on for named accounts only (testing a locked
-- feature before it is opened to everybody). The flag itself stays off.

alter table self_audit_feature_flags add column enabled_for uuid[] not null default '{}';

create or replace function public.feature_enabled(p_key text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select enabled or coalesce(auth.uid() = any(enabled_for), false) from self_audit_feature_flags where key = p_key),
    false
  );
$$;

-- Testing account "a@a" (branch admin) gets the Rejected Claims Diary while it is locked for everyone else.
update self_audit_feature_flags
set enabled_for = array['897354ed-05df-4f80-95a3-3005f454c3c1'::uuid]
where key = 'rejected_claims_branch_admins';
