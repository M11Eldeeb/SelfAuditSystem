-- One-off data fix: claims whose work order prefix is exactly a branch code but which were filed under another
-- branch's dealer code (Abha job cards under Madina Rd / Riyadh Khurais / Riyadh Al Saleh, Nakheel job cards under
-- Jeddah Heraa, a few single ones) move to the branch named by the work order. The uploads now do the same.
create temporary table moved_claims on commit drop as
select c.id, tb.id as new_branch
from public.self_audit_claims c
join public.self_audit_branches tb on tb.code = upper(substring(c.work_order_no from '^([A-Za-z]+)\s*-'))
where tb.id <> c.branch_id;

update public.self_audit_claims c set branch_id = m.new_branch from moved_claims m where c.id = m.id;
update public.self_audit_claim_parts p set branch_id = m.new_branch from moved_claims m where p.claim_id = m.id;
update public.self_audit_scrap_requests s set branch_id = m.new_branch from moved_claims m where s.claim_id = m.id;
update public.self_audit_upload_batch_kept_claims k set branch_id = m.new_branch from moved_claims m where k.claim_id = m.id;

select public.refresh_do_not_scrap_cache();
