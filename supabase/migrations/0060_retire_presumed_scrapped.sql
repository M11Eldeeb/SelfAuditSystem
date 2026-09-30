-- presumed_scrapped was a guess: pending scrap requests silently written off
-- after a cycle passed, with no real evidence they were actually destroyed.
-- Officer's directive: the destroy list is the source of truth for
-- "already scrapped" - anything not in it stays actively flagged until
-- real evidence exists (destroy list re-upload, or approved destroy
-- evidence). No more presuming.
--
-- Of 3,679 presumed_scrapped rows: 1,852 already exist in the destroy list
-- (self_audit_scrapped_parts) - redundant, and were actually double-counting
-- the same claim in the Scrapped List report (once via each source). Those
-- are deleted outright. The remaining 1,827 have no real evidence either
-- way - reverted to 'pending' so they're actively flagged again.
delete from self_audit_scrap_requests sr
where sr.status = 'presumed_scrapped'
  and exists (select 1 from self_audit_scrapped_parts sp where sp.claim_id = sr.claim_id);

update self_audit_scrap_requests
set status = 'pending'
where status = 'presumed_scrapped';

-- No more auto-write-off mechanism, and no more 'presumed_scrapped' status
-- going forward - self_audit_scrap_requests is just pending/scrapped now.
alter table self_audit_scrap_requests drop constraint self_audit_scrap_requests_status_check;
alter table self_audit_scrap_requests add constraint self_audit_scrap_requests_status_check
  check (status = any (array['pending', 'scrapped']));

drop function if exists public.release_scrap_requests_for_new_cycle();
