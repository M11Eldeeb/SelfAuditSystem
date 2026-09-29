-- Replaces per-claim scrap-video submission (submit_scrap_request) as the
-- branch admin's day-to-day destruction-evidence workflow: one bulk video
-- submission per branch per self-audit cycle, same 25-day deadline
-- (AUDIT_CYCLE_DEADLINE_DAYS), instead of one video-required-per-claim.
-- submit_scrap_request/scrap_request_videos stay in the schema untouched -
-- still the historical record for everything already scrapped that way.
create table self_audit_destroy_evidence (
  cycle_id uuid not null references self_audit_audit_cycles(id) on delete cascade,
  branch_id uuid not null references self_audit_branches(id),
  status text not null default 'pending' check (status in ('pending', 'submitted', 'sent')),
  submitted_at timestamptz,
  submitted_by uuid references self_audit_users(id),
  sent_at timestamptz,
  sent_by uuid references self_audit_users(id),
  primary key (cycle_id, branch_id)
);

create table self_audit_destroy_evidence_videos (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null,
  branch_id uuid not null,
  video_path text not null,
  created_at timestamptz not null default now(),
  foreign key (cycle_id, branch_id) references self_audit_destroy_evidence(cycle_id, branch_id) on delete cascade
);

alter table self_audit_destroy_evidence enable row level security;
alter table self_audit_destroy_evidence_videos enable row level security;

create policy "branch admins manage own destroy_evidence"
  on self_audit_destroy_evidence for all
  using (branch_id = current_user_branch_id())
  with check (branch_id = current_user_branch_id());

create policy "officers manage destroy_evidence"
  on self_audit_destroy_evidence for all
  using (current_user_role() = 'officer')
  with check (current_user_role() = 'officer');

create policy "branch admins manage own destroy_evidence_videos"
  on self_audit_destroy_evidence_videos for all
  using (branch_id = current_user_branch_id())
  with check (branch_id = current_user_branch_id());

create policy "officers manage destroy_evidence_videos"
  on self_audit_destroy_evidence_videos for all
  using (current_user_role() = 'officer')
  with check (current_user_role() = 'officer');

-- Storage: videos live at destroy-evidence/{branchId}/{cycleId}/... in the
-- existing warranty-room-files bucket. Officers get DELETE here (scoped to
-- just this folder prefix, not the whole bucket) so "download then mark
-- sent" can actually remove the files - the bucket's existing officer policy
-- was SELECT-only.
create policy "branch admins manage own destroy evidence files"
  on storage.objects for all
  using (
    bucket_id = 'warranty-room-files'
    and (storage.foldername(name))[1] = 'destroy-evidence'
    and (storage.foldername(name))[2] = (current_user_branch_id())::text
  )
  with check (
    bucket_id = 'warranty-room-files'
    and (storage.foldername(name))[1] = 'destroy-evidence'
    and (storage.foldername(name))[2] = (current_user_branch_id())::text
  );

create policy "officers manage destroy evidence files"
  on storage.objects for all
  using (
    bucket_id = 'warranty-room-files'
    and (storage.foldername(name))[1] = 'destroy-evidence'
    and current_user_role() = 'officer'
  )
  with check (
    bucket_id = 'warranty-room-files'
    and (storage.foldername(name))[1] = 'destroy-evidence'
    and current_user_role() = 'officer'
  );
