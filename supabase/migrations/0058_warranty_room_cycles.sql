-- Destroy evidence's deadline/cycle was borrowed from the self-audit cycle
-- (self_audit_audit_cycles) - officer wants it fully independent: its own
-- "Generate cycle" button, own month picker, own 25-day deadline, not tied
-- to when the self-audit cycle happens to be generated.
create table self_audit_warranty_room_cycles (
  id uuid primary key default gen_random_uuid(),
  cycle_month date not null unique,
  status text not null default 'open' check (status in ('open')),
  deadline_at timestamptz,
  created_by uuid references self_audit_users(id),
  created_at timestamptz not null default now()
);

alter table self_audit_warranty_room_cycles enable row level security;

create policy "authenticated read warranty_room_cycles"
  on self_audit_warranty_room_cycles for select
  using (auth.role() = 'authenticated');

create policy "officers manage warranty_room_cycles"
  on self_audit_warranty_room_cycles for all
  using (current_user_role() = 'officer')
  with check (current_user_role() = 'officer');

-- 2 real destroy_evidence rows already exist (one already approved) -
-- seeds a row reusing the SAME id as the self-audit cycle they currently
-- point to, so the FK repoint needs no data migration on that table.
insert into self_audit_warranty_room_cycles (id, cycle_month, deadline_at, created_by, created_at)
values ('ab3888c2-ad3a-402b-8332-2c9b579db8cf', '2026-09-01', '2026-10-01 07:23:59.77+00', '092bf5b6-a540-4384-aac1-c3050c8de0ca', '2026-09-01 07:23:59.901748+00');

alter table self_audit_destroy_evidence drop constraint self_audit_destroy_evidence_cycle_id_fkey;
alter table self_audit_destroy_evidence
  add constraint self_audit_destroy_evidence_cycle_id_fkey
  foreign key (cycle_id) references self_audit_warranty_room_cycles(id) on delete cascade;
