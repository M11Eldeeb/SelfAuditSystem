-- Finance accounts: no branch, read-only access to the outstanding-claims
-- summary at /finance, served by get_finance_summary (migration 0067). No
-- table policies are added - a finance user's own session still can't read
-- any claim rows (claims policies only allow officers and a branch admin's
-- own branch).
alter type user_role add value if not exists 'finance';

-- The original check only allowed officer or branch_admin-with-branch.
-- Compared as text: a just-added enum value can't be referenced as an enum
-- literal in the same transaction.
alter table self_audit_users drop constraint branch_admin_requires_branch;
alter table self_audit_users add constraint branch_admin_requires_branch check (
  (role::text = 'branch_admin' and branch_id is not null) or role::text in ('officer', 'finance')
);
