-- Warranty Room Management: tracks what happens to a claim's removed parts
-- after settlement - already scrapped, queued to be scrapped, reserved for
-- the manufacturer's supplier to collect, or none of the above (kept, not
-- scrapped). Purely additive: no existing table is altered, and nothing here
-- is read by the current self-audit/internal-audit sampling code yet (that
-- integration is a deliberate later, separate step).

-- ---------------------------------------------------------------------------
-- Every part on a claim (Part Details sheet) - broader than
-- self_audit_claims.main_part_name, which only ever captured one part.
-- ---------------------------------------------------------------------------
create table self_audit_claim_parts (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references self_audit_claims (id) on delete cascade,
  branch_id uuid not null references self_audit_branches (id),
  part_no text not null,
  part_name text,
  quantity numeric,
  upload_batch_id uuid references self_audit_upload_batches (id),
  created_at timestamptz not null default now(),
  unique (claim_id, part_no)
);
create index self_audit_claim_parts_claim_idx on self_audit_claim_parts (claim_id);
create index self_audit_claim_parts_branch_idx on self_audit_claim_parts (branch_id);

-- ---------------------------------------------------------------------------
-- "Parts Already Scraped" upload - reference data only, no workflow.
-- claim_id is nullable: still worth keeping a row (for the do-not-scrap
-- report and future sampling exclusion) even if the claim number doesn't
-- match anything currently in self_audit_claims.
-- ---------------------------------------------------------------------------
create table self_audit_scrapped_parts (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid references self_audit_claims (id) on delete set null,
  external_request_no text,
  work_order_no text,
  vin text,
  part_no text,
  part_name text,
  quantity numeric,
  main_labor_code text,
  main_labor_name text,
  settlement_date date,
  holding_period_days integer,
  upload_batch_id uuid references self_audit_upload_batches (id),
  created_at timestamptz not null default now()
);
create index self_audit_scrapped_parts_claim_idx on self_audit_scrapped_parts (claim_id);

-- ---------------------------------------------------------------------------
-- "Parts should be scraped" upload -> one row per claim, then the branch
-- destroys the parts and the officer (and, on escalation, the manufacturer)
-- reviews. status is the current state; self_audit_scrap_request_events
-- below is the full append-only trail with comments.
-- ---------------------------------------------------------------------------
create table self_audit_scrap_requests (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references self_audit_claims (id),
  branch_id uuid not null references self_audit_branches (id),
  work_order_no text,
  main_labor_code text,
  main_labor_name text,
  settlement_date date,
  holding_period_days integer,
  status text not null default 'pending_branch',
  video_path text,
  submitted_at timestamptz,
  upload_batch_id uuid references self_audit_upload_batches (id),
  created_at timestamptz not null default now(),
  unique (claim_id),
  constraint self_audit_scrap_requests_status_check check (status in (
    'pending_branch', 'pending_review', 'returned_to_branch', 'rejected',
    'pending_manufacturer', 'manufacturer_returned', 'manufacturer_rejected', 'approved'
  ))
);
create index self_audit_scrap_requests_branch_status_idx on self_audit_scrap_requests (branch_id, status);

create table self_audit_scrap_request_parts (
  id uuid primary key default gen_random_uuid(),
  scrap_request_id uuid not null references self_audit_scrap_requests (id) on delete cascade,
  part_no text not null,
  part_name text,
  quantity numeric
);
create index self_audit_scrap_request_parts_request_idx on self_audit_scrap_request_parts (scrap_request_id);

create table self_audit_scrap_request_events (
  id uuid primary key default gen_random_uuid(),
  scrap_request_id uuid not null references self_audit_scrap_requests (id) on delete cascade,
  event_type text not null,
  actor_id uuid references self_audit_users (id),
  comment text,
  created_at timestamptz not null default now()
);
create index self_audit_scrap_request_events_request_idx on self_audit_scrap_request_events (scrap_request_id);

-- ---------------------------------------------------------------------------
-- "Supplier Parts" upload -> grouped into one collection per branch (a
-- physical hand-over/signature happens at one branch at a time even if the
-- uploaded sheet spans several).
-- ---------------------------------------------------------------------------
create table self_audit_supplier_collections (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references self_audit_branches (id),
  upload_batch_id uuid references self_audit_upload_batches (id),
  collection_date date,
  status text not null default 'pending',
  signed_pdf_path text,
  video_path text,
  branch_rep_name text,
  supplier_rep_name text,
  handed_over_at timestamptz,
  handed_over_by uuid references self_audit_users (id),
  created_at timestamptz not null default now(),
  constraint self_audit_supplier_collections_status_check check (status in (
    'pending', 'signed_uploaded', 'handed_over'
  ))
);
create index self_audit_supplier_collections_branch_status_idx on self_audit_supplier_collections (branch_id, status);

create table self_audit_supplier_collection_parts (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references self_audit_supplier_collections (id) on delete cascade,
  claim_id uuid references self_audit_claims (id),
  work_order_no text,
  vin text,
  main_labor_name text,
  part_no text,
  part_name text,
  planned_pickup_date date,
  created_at timestamptz not null default now()
);
create index self_audit_supplier_collection_parts_collection_idx on self_audit_supplier_collection_parts (collection_id);
create index self_audit_supplier_collection_parts_claim_idx on self_audit_supplier_collection_parts (claim_id);

-- ---------------------------------------------------------------------------
-- Row Level Security - same officer-manages-all / branch-admin-scoped-narrow
-- pattern as every existing table (see current_user_role()/current_user_branch_id()
-- in migration 0010).
-- ---------------------------------------------------------------------------
alter table self_audit_claim_parts enable row level security;
alter table self_audit_scrapped_parts enable row level security;
alter table self_audit_scrap_requests enable row level security;
alter table self_audit_scrap_request_parts enable row level security;
alter table self_audit_scrap_request_events enable row level security;
alter table self_audit_supplier_collections enable row level security;
alter table self_audit_supplier_collection_parts enable row level security;

create policy "officers manage claim_parts" on self_audit_claim_parts for all
  using (current_user_role() = 'officer') with check (current_user_role() = 'officer');
create policy "branch admins read own claim_parts" on self_audit_claim_parts for select
  using (branch_id = current_user_branch_id());

create policy "officers manage scrapped_parts" on self_audit_scrapped_parts for all
  using (current_user_role() = 'officer') with check (current_user_role() = 'officer');

create policy "officers manage scrap_requests" on self_audit_scrap_requests for all
  using (current_user_role() = 'officer') with check (current_user_role() = 'officer');
create policy "branch admins read own scrap_requests" on self_audit_scrap_requests for select
  using (branch_id = current_user_branch_id());
create policy "branch admins update own scrap_requests" on self_audit_scrap_requests for update
  using (branch_id = current_user_branch_id())
  with check (branch_id = current_user_branch_id());

create policy "officers manage scrap_request_parts" on self_audit_scrap_request_parts for all
  using (current_user_role() = 'officer') with check (current_user_role() = 'officer');
create policy "branch admins read own scrap_request_parts" on self_audit_scrap_request_parts for select
  using (exists (
    select 1 from self_audit_scrap_requests r
    where r.id = self_audit_scrap_request_parts.scrap_request_id and r.branch_id = current_user_branch_id()
  ));

create policy "officers manage scrap_request_events" on self_audit_scrap_request_events for all
  using (current_user_role() = 'officer') with check (current_user_role() = 'officer');
create policy "branch admins read own scrap_request_events" on self_audit_scrap_request_events for select
  using (exists (
    select 1 from self_audit_scrap_requests r
    where r.id = self_audit_scrap_request_events.scrap_request_id and r.branch_id = current_user_branch_id()
  ));

create policy "officers manage supplier_collections" on self_audit_supplier_collections for all
  using (current_user_role() = 'officer') with check (current_user_role() = 'officer');
create policy "branch admins read own supplier_collections" on self_audit_supplier_collections for select
  using (branch_id = current_user_branch_id());
create policy "branch admins update own supplier_collections" on self_audit_supplier_collections for update
  using (branch_id = current_user_branch_id())
  with check (branch_id = current_user_branch_id());

create policy "officers manage supplier_collection_parts" on self_audit_supplier_collection_parts for all
  using (current_user_role() = 'officer') with check (current_user_role() = 'officer');
create policy "branch admins read own supplier_collection_parts" on self_audit_supplier_collection_parts for select
  using (exists (
    select 1 from self_audit_supplier_collections c
    where c.id = self_audit_supplier_collection_parts.collection_id and c.branch_id = current_user_branch_id()
  ));

-- ---------------------------------------------------------------------------
-- Storage bucket for scrap-destruction videos and supplier signed PDFs/videos
-- (same private-bucket + path-prefix-ownership pattern as audit-photos in
-- migration 0001).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('warranty-room-files', 'warranty-room-files', false)
on conflict (id) do nothing;

create policy "officers read warranty room files" on storage.objects for select
  using (bucket_id = 'warranty-room-files' and current_user_role() = 'officer');

create policy "branch admins manage own warranty room files" on storage.objects for all
  using (
    bucket_id = 'warranty-room-files'
    and (
      exists (
        select 1 from self_audit_scrap_requests r
        where r.id::text = (storage.foldername(name)) [1] and r.branch_id = current_user_branch_id()
      )
      or exists (
        select 1 from self_audit_supplier_collections c
        where c.id::text = (storage.foldername(name)) [1] and c.branch_id = current_user_branch_id()
      )
    )
  )
  with check (
    bucket_id = 'warranty-room-files'
    and (
      exists (
        select 1 from self_audit_scrap_requests r
        where r.id::text = (storage.foldername(name)) [1] and r.branch_id = current_user_branch_id()
      )
      or exists (
        select 1 from self_audit_supplier_collections c
        where c.id::text = (storage.foldername(name)) [1] and c.branch_id = current_user_branch_id()
      )
    )
  );
