-- Officer follow-up reminders for overdue branch tasks: a branch task is due
-- a reminder once it's 5 days old, then again every 2 days after the last
-- reminder. The reminder itself is an email draft (mailto) the officer
-- sends; this logs that it was sent so the next one is due 2 days later.

create table if not exists self_audit_task_reminders (
  id uuid primary key default gen_random_uuid(),
  -- Stable task identity, e.g. "self_audit:<cycle_id>:<branch_id>".
  task_key text not null,
  branch_id uuid not null references self_audit_branches (id) on delete cascade,
  sent_by uuid references self_audit_users (id) on delete set null,
  sent_at timestamptz not null default now()
);

create index if not exists self_audit_task_reminders_task_idx on self_audit_task_reminders (task_key, sent_at desc);

alter table self_audit_task_reminders enable row level security;
create policy "officers manage task_reminders" on self_audit_task_reminders for all
  using ((select current_user_role()) = 'officer') with check ((select current_user_role()) = 'officer');
create policy "branch admins read own task_reminders" on self_audit_task_reminders for select
  using (branch_id = (select current_user_branch_id()));
