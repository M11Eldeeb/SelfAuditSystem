-- Courtesy (replacement) car agreements made in the portal.
-- 1. The customer opens the branch's link / QR (/cc/<branch code>), fills in his details, picks his service advisor, reads
--    the terms and signs: status 'requested' (the advisor gets an e-mail).
-- 2. The advisor picks the car (from the courtesy cars sheet), records mileage, fuel, damage marks on the walk-around
--    drawing, WIP number, agreement expiry, notes, photos and signs: status 'open' (the car is with the customer).
-- 3. When the car comes back: mileage and fuel in: status 'closed'. Or 'cancelled'.
-- Signatures, the licence photo and the car photos are files in the private bucket 'courtesy'.
create table if not exists self_audit_courtesy_agreements (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  branch_id uuid not null references self_audit_branches(id),
  status text not null default 'requested' check (status in ('requested', 'open', 'closed', 'cancelled')),
  lang text not null default 'ar' check (lang in ('ar', 'en')),
  -- the customer
  customer_name text not null,
  phone text not null,
  id_number text not null,
  birth_date date not null,
  nationality text not null,
  advisor_id uuid references self_audit_users(id),
  advisor_name text,
  customer_signature text,
  license_photo text,
  terms_accepted_at timestamptz,
  requested_at timestamptz not null default now(),
  -- the advisor (handover)
  vehicle_label text,
  vehicle_plate text,
  vehicle_model text,
  vehicle_vin text,
  mileage_out integer,
  fuel_out integer check (fuel_out between 0 and 100),
  damages jsonb not null default '[]',
  wip_no text,
  expires_at timestamptz,
  notes text,
  advisor_signature text,
  photos text[] not null default '{}',
  handed_over_at timestamptz,
  handed_over_by uuid references self_audit_users(id),
  handed_over_by_name text,
  -- the return
  mileage_in integer,
  fuel_in integer check (fuel_in between 0 and 100),
  return_note text,
  returned_at timestamptz,
  returned_by_name text,
  updated_at timestamptz not null default now()
);
create index if not exists self_audit_courtesy_agreements_branch on self_audit_courtesy_agreements (branch_id, status, requested_at desc);
create index if not exists self_audit_courtesy_agreements_advisor on self_audit_courtesy_agreements (advisor_id, status);
alter table self_audit_courtesy_agreements enable row level security;

insert into storage.buckets (id, name, public) values ('courtesy', 'courtesy', false) on conflict (id) do nothing;
