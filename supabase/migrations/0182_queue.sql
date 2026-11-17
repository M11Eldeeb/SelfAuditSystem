-- Customer queue system, moved from the separate MG Queue app: branch registration (kiosk / QR), the service advisor
-- and spare parts queues, the TV display, the customer's ticket page, queue settings, analytics, HQ and the team list.
-- Every table is read and written by the server only (service role), so RLS is on with no policies: the public pages
-- (registration, ticket, TV) go through server actions that check what they may see and change.

-- Branches: the queue's code (kept from the old app, so printed QR codes still mean the same branch), Arabic name and
-- whether the queue takes new customers.
alter table self_audit_branches add column if not exists queue_code text;
alter table self_audit_branches add column if not exists name_ar text;
alter table self_audit_branches add column if not exists queue_status text not null default 'open'
  check (queue_status in ('open', 'paused', 'closed'));
create unique index if not exists self_audit_branches_queue_code_idx on self_audit_branches (upper(queue_code));

-- Users: what the person does in the queue, beside the portal role. 'advisor' calls service customers, 'parts_advisor'
-- calls spare parts customers, 'manager' runs the branch queue (sees the list, assigns, settings, TV); a manager
-- without a branch (head office) sees every branch. The job title is shown in the team list.
alter table self_audit_users add column if not exists queue_role text check (queue_role in ('advisor', 'parts_advisor', 'manager'));
alter table self_audit_users add column if not exists job_title text;

-- queue_user: branch optional (head office queue managers / parts staff have none).
alter table self_audit_users drop constraint if exists branch_admin_requires_branch;
alter table self_audit_users add constraint branch_admin_requires_branch check (
  (role::text = any (array['branch_admin', 'workshop_supervisor', 'team_leader', 'service_manager', 'technician', 'claims_reviewer', 'service_advisor', 'quality_controller']) and branch_id is not null)
  or role::text = any (array['officer', 'finance', 'technical', 'manager', 'national_manager', 'queue_user'])
);

create table if not exists self_audit_queue_tickets (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references self_audit_branches (id) on delete cascade,
  ticket_number text,
  customer_name text not null,
  mobile text not null,
  service_mode text not null check (service_mode in ('appointment', 'walk_in', 'inquiry', 'spare_parts')),
  wip_service_type text check (wip_service_type in ('general_repair', 'quick_service', 'vehicle_delivery')),
  wip_number text,
  status text not null default 'waiting' check (status in ('waiting', 'called', 'in_service', 'completed', 'no_show', 'cancelled', 'held')),
  -- who serves it (the name is kept as shown, also for tickets copied from the old app)
  advisor_id uuid references self_audit_users (id) on delete set null,
  advisor_name text,
  -- reserved by a manager for one advisor; urgent = served next by that advisor
  preassigned_advisor_id uuid references self_audit_users (id) on delete set null,
  preassigned_advisor_name text,
  preassign_urgent boolean not null default false,
  held_at timestamptz,
  was_held boolean not null default false,
  notes text,
  queue_entry_at timestamptz not null default now(),
  served_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists self_audit_queue_tickets_branch_status_idx on self_audit_queue_tickets (branch_id, status, queue_entry_at);
create index if not exists self_audit_queue_tickets_branch_day_idx on self_audit_queue_tickets (branch_id, queue_entry_at desc);
create index if not exists self_audit_queue_tickets_mobile_idx on self_audit_queue_tickets (mobile, status);
alter table self_audit_queue_tickets enable row level security;

-- Ticket numbers A-001, A-002 ... per branch per day (Saudi time). The lock keeps two customers joining at the same
-- moment from getting the same number.
create or replace function self_audit_queue_ticket_number() returns trigger
language plpgsql set search_path = public as $$
declare
  v_day date := (now() at time zone 'Asia/Riyadh')::date;
  v_seq int;
begin
  if new.ticket_number is not null then return new; end if;
  perform pg_advisory_xact_lock(hashtext('queue:' || new.branch_id::text || ':' || v_day::text));
  select count(*) + 1 into v_seq from self_audit_queue_tickets
   where branch_id = new.branch_id and (queue_entry_at at time zone 'Asia/Riyadh')::date = v_day;
  new.ticket_number := 'A-' || lpad(v_seq::text, 3, '0');
  return new;
end $$;
drop trigger if exists self_audit_queue_ticket_number_trg on self_audit_queue_tickets;
create trigger self_audit_queue_ticket_number_trg before insert on self_audit_queue_tickets
  for each row execute function self_audit_queue_ticket_number();

-- How "Call next customer" picks, per branch.
create table if not exists self_audit_queue_settings (
  branch_id uuid primary key references self_audit_branches (id) on delete cascade,
  priority_order jsonb not null default '["inquiry","appointment","vehicle_delivery","general_repair","quick_service"]',
  fairness_enabled boolean not null default true,
  fairness_override_minutes integer not null default 15 check (fairness_override_minutes between 0 and 240),
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table self_audit_queue_settings enable row level security;

-- The customer's phone, subscribed for the "your turn" alert (browser push).
create table if not exists self_audit_queue_push (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references self_audit_queue_tickets (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index if not exists self_audit_queue_push_ticket_idx on self_audit_queue_push (ticket_id);
alter table self_audit_queue_push enable row level security;

-- Team directory (the after-sales employee list from the old app), kept by the warranty team.
create table if not exists self_audit_queue_employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  title text,
  city text,
  branch_id uuid references self_audit_branches (id) on delete set null,
  branch_name text, -- as in the list (e.g. "Head Office")
  phone text,
  email text,
  -- their part in the queue in the old app (advisor / parts_advisor / manager): used by the account import
  queue_role text check (queue_role in ('advisor', 'parts_advisor', 'manager')),
  created_at timestamptz not null default now()
);
create index if not exists self_audit_queue_employees_branch_idx on self_audit_queue_employees (branch_id);
alter table self_audit_queue_employees enable row level security;
