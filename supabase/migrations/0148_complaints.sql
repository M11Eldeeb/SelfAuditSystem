-- Complaints (Reports > Complaints): the monthly "Complaints Tracker Report" e-mail (MOC, SAIC and CRM complaints) is
-- imported here. The file is cumulative, so each import upserts every row by its complaint key. Customer names and
-- mobile numbers in the file are not stored. Internal complaints are read live from their Google Sheet (not stored).

create table if not exists self_audit_complaints (
  key text primary key,                 -- "<source>|<complaint no>" (or "<source>|<date>|<vin>" when the number is blank)
  source text not null,                 -- MOC / SAIC / CRM
  complaint_no text,
  created_on date,
  status text,
  resolved_on date,
  category text,
  subcategory text,
  vin text,
  validity text,                        -- Valid / Not Valid
  region text,
  branch_label text,                    -- as in the file, e.g. "A7 MG Jeddah Heraa"
  dealer_code text,                     -- A7, B7, ...
  branch_id uuid references self_audit_branches(id),
  service_advisor text,
  representative text,
  imported_at timestamptz not null default now()
);
create index if not exists self_audit_complaints_created_idx on self_audit_complaints (created_on);
create index if not exists self_audit_complaints_branch_idx on self_audit_complaints (branch_id);
alter table self_audit_complaints enable row level security;

create table if not exists self_audit_complaint_imports (
  id uuid primary key default gen_random_uuid(),
  gmail_message_id text,
  subject text,
  received_at timestamptz,
  file_name text,
  rows integer not null default 0,
  imported_at timestamptz not null default now(),
  imported_by uuid references self_audit_users(id) on delete set null
);
alter table self_audit_complaint_imports enable row level security;
