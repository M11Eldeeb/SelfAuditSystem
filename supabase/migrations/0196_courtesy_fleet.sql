-- Courtesy car fleet managed in the portal. The cars come from the courtesy cars sheet (copied in by plate the first time
-- they are seen); from then on the portal keeps each car's branch, condition, mileage and service, and its history.
--  * condition: what the reception manager / warranty officer set: available, accident, maintenance, on_hold, out_of_service
--    (a car out on an agreement shows as on loan without changing its condition).
--  * service every 10,000 km: last_service_km + 10,000 is the next service; the bell and the dashboard warn when it is near.
--  * transfers: warranty officers and national managers ask a branch to move a car to another branch; the branch marks it
--    sent, the other branch marks it received (or anyone of them cancels).
create table if not exists self_audit_courtesy_vehicles (
  id uuid primary key default gen_random_uuid(),
  plate text not null,
  plate_key text not null unique,
  model text,
  vin text,
  branch_id uuid references self_audit_branches(id),
  condition text not null default 'available' check (condition in ('available', 'accident', 'maintenance', 'on_hold', 'out_of_service')),
  condition_note text,
  condition_at timestamptz,
  km integer,
  last_service_km integer,
  last_service_at date,
  service_interval_km integer not null default 10000,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists self_audit_courtesy_vehicles_branch on self_audit_courtesy_vehicles (branch_id);

create table if not exists self_audit_courtesy_vehicle_events (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references self_audit_courtesy_vehicles(id) on delete cascade,
  kind text not null check (kind in ('condition', 'service', 'km', 'loan_out', 'loan_in', 'transfer_requested', 'transfer_sent', 'transfer_received', 'transfer_cancelled', 'note', 'added')),
  body text,
  km integer,
  agreement_id uuid references self_audit_courtesy_agreements(id) on delete set null,
  from_branch uuid references self_audit_branches(id),
  to_branch uuid references self_audit_branches(id),
  by_id uuid references self_audit_users(id),
  by_name text,
  created_at timestamptz not null default now()
);
create index if not exists self_audit_courtesy_vehicle_events_vehicle on self_audit_courtesy_vehicle_events (vehicle_id, created_at desc);

create table if not exists self_audit_courtesy_transfers (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references self_audit_courtesy_vehicles(id) on delete cascade,
  from_branch uuid not null references self_audit_branches(id),
  to_branch uuid not null references self_audit_branches(id),
  reason text,
  status text not null default 'requested' check (status in ('requested', 'sent', 'received', 'cancelled')),
  requested_by uuid references self_audit_users(id),
  requested_by_name text,
  requested_at timestamptz not null default now(),
  sent_at timestamptz,
  sent_by_name text,
  received_at timestamptz,
  received_by_name text,
  cancelled_at timestamptz,
  cancelled_by_name text
);
create index if not exists self_audit_courtesy_transfers_open on self_audit_courtesy_transfers (status, from_branch, to_branch);

alter table self_audit_courtesy_agreements add column if not exists vehicle_id uuid references self_audit_courtesy_vehicles(id);
create index if not exists self_audit_courtesy_agreements_vehicle on self_audit_courtesy_agreements (vehicle_id, handed_over_at desc);

alter table self_audit_courtesy_vehicles enable row level security;
alter table self_audit_courtesy_vehicle_events enable row level security;
alter table self_audit_courtesy_transfers enable row level security;
