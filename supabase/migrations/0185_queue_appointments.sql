-- Customer queue: the DMS appointments sheet ("Appointment Detail", one row per booked visit: branch, WIP, date, time,
-- customer, mobile, VIN). It arrives daily by e-mail (subject with "Appointment", read from the connected mailbox) and a
-- warranty officer can also upload it. A customer who joins the queue as "Appointment" is matched by mobile, else by the
-- WIP number they type: an appointment today -> appointment priority (date and time shown); another day or none found ->
-- told so and joins as a walk-in. Server only (RLS on, no policies).
create table if not exists self_audit_queue_appointments (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references self_audit_branches (id) on delete cascade,
  wip_no text not null,
  appt_date date not null,
  appt_time time,
  customer_name text,
  mobile text,              -- +9665XXXXXXXX when the sheet's number is a Saudi mobile
  vin text,
  description text,
  service_reception text,   -- the advisor named in the sheet (shown only)
  status_text text,         -- "Not Visited" ... as in the sheet
  appointment_code text,
  source text not null default 'mail' check (source in ('mail', 'upload')),
  imported_at timestamptz not null default now(),
  unique (branch_id, wip_no, appt_date)
);
create index if not exists self_audit_queue_appointments_mobile_idx on self_audit_queue_appointments (mobile, appt_date);
create index if not exists self_audit_queue_appointments_day_idx on self_audit_queue_appointments (branch_id, appt_date);
alter table self_audit_queue_appointments enable row level security;

create table if not exists self_audit_queue_appointment_imports (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('mail', 'upload')),
  gmail_message_id text,
  subject text,
  file_name text,
  received_at timestamptz,
  rows integer not null default 0,
  imported_by uuid references self_audit_users (id) on delete set null,
  imported_at timestamptz not null default now()
);
create index if not exists self_audit_queue_appointment_imports_idx on self_audit_queue_appointment_imports (imported_at desc);
alter table self_audit_queue_appointment_imports enable row level security;

-- The ticket of a customer who came for an appointment: which one, and its time (shown at the desk).
alter table self_audit_queue_tickets add column if not exists appointment_id uuid references self_audit_queue_appointments (id) on delete set null;
alter table self_audit_queue_tickets add column if not exists appointment_at timestamptz;

-- Looks for a new appointments e-mail every hour from 06:00 to 23:00 Saudi time (nothing is downloaded until a new one is there).
select cron.schedule('self-audit-queue-appointments', '5 3-20 * * *', $$select public.call_cron_route('/api/cron/queue-appointments')$$);
