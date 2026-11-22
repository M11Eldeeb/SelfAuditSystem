-- The 3D business view's department details, for every branch together (p_branch null) or one branch: workshop (open
-- WIPs, ageing, overdue against the promised date, status, quality control, technician claims), warranty (claims of the
-- year, settlement, technical inquiries, verification codes, rejected claims), warranty room (scrap cycle, destroy
-- evidence, part returns, supplier collections), audit (self-audit cycle, internal audits), customers (queue today,
-- appointments) and complaints. Read by the server with the service role only.
create or replace function public.business_town(p_branch uuid default null)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
with
  today as (select (now() at time zone 'Asia/Riyadh')::date d),
  yr as (select date_trunc('year', (select d from today))::date y),
  w as (select * from self_audit_open_wips where p_branch is null or branch_id = p_branch),
  cs as (select * from self_audit_claim_settlement where (p_branch is null or branch_id = p_branch) and creation_date >= (select y from yr)),
  tc as (select * from self_audit_tech_claims where p_branch is null or branch_id = p_branch),
  qc as (select * from self_audit_qc_checks where (p_branch is null or branch_id = p_branch) and created_at >= (select y from yr)),
  ti as (select * from self_audit_technical_inquiries where (p_branch is null or branch_id = p_branch) and created_at >= (select y from yr)),
  vr as (select * from self_audit_verification_requests where (p_branch is null or branch_id = p_branch) and created_at >= (select y from yr)),
  cmp as (select * from self_audit_complaints where (p_branch is null or branch_id = p_branch) and created_on >= (select y from yr)),
  wrc as (select * from self_audit_warranty_room_cycles order by cycle_month desc limit 1),
  ac as (select * from self_audit_audit_cycles order by cycle_month desc limit 1),
  qt as (
    select * from self_audit_queue_tickets
    where (p_branch is null or branch_id = p_branch)
      and created_at >= ((select d from today)::timestamp at time zone 'Asia/Riyadh')
  )
select jsonb_build_object(
  'workshop', jsonb_build_object(
    'open', (select count(*) from w),
    'value', (select coalesce(round(sum(invoiceable)), 0) from w),
    'labour', (select coalesce(round(sum(wip_labour)), 0) from w),
    'parts', (select coalesce(round(sum(wip_parts)), 0) from w),
    'avgAge', (select round(avg((select d from today) - received), 1) from w where received is not null),
    'ageing', jsonb_build_array(
      (select count(*) from w where (select d from today) - received <= 7),
      (select count(*) from w where (select d from today) - received between 8 and 15),
      (select count(*) from w where (select d from today) - received between 16 and 30),
      (select count(*) from w where (select d from today) - received between 31 and 60),
      (select count(*) from w where (select d from today) - received > 60)
    ),
    'overdue', (select count(*) from w where due_out < (select d from today)),
    'dueToday', (select count(*) from w where due_out = (select d from today)),
    'awaitingParts', (select count(*) from w where wip_status ilike 'awaiting parts%'),
    'completeNotInvoiced', (select count(*) from w where wip_status ilike 'complete but not invoiced%'),
    'statuses', (select coalesce(jsonb_agg(jsonb_build_object('label', s, 'n', n) order by n desc), '[]') from (select coalesce(wip_status, '-') s, count(*) n from w group by 1 order by 2 desc limit 7) x),
    'trend', (
      select coalesce(jsonb_agg(jsonb_build_object('day', day, 'n', n) order by day), '[]')
      from (select day, sum(count) n from self_audit_open_wip_daily where (p_branch is null or branch_id = p_branch) and day >= (select d from today) - 30 group by day) x
    ),
    'qc', jsonb_build_object(
      'total', (select count(*) from qc),
      'passed', (select count(*) from qc where status = 'passed'),
      'failed', (select count(*) from qc where status = 'failed'),
      'firstTime', (select count(*) from qc where status = 'passed' and coalesce(attempts, 1) <= 1)
    ),
    'techClaims', jsonb_build_object(
      'waiting', (select count(*) from tc where status = 'submitted'),
      'returned', (select count(*) from tc where status = 'returned'),
      'approved', (select count(*) from tc where status = 'approved' and reviewed_at >= (select y from yr)),
      'rejected', (select count(*) from tc where status = 'rejected' and reviewed_at >= (select y from yr)),
      'reviewHours', (select round(avg(extract(epoch from reviewed_at - submitted_at) / 3600)::numeric, 1) from tc where reviewed_at is not null and submitted_at is not null and reviewed_at >= now() - interval '90 days')
    )
  ),
  'warranty', jsonb_build_object(
    'claims', (select count(*) from cs),
    'amount', (select coalesce(round(sum(claim_amount)), 0) from cs),
    'settled', (select count(*) from cs where status in ('Settled', 'Closed')),
    'settledAmount', (select coalesce(round(sum(claim_amount)), 0) from cs where status in ('Settled', 'Closed')),
    'rejected', (select count(*) from cs where status = 'Rejected'),
    'inProgress', (select count(*) from cs where status not in ('Settled', 'Closed', 'Rejected')),
    'returned', (select count(*) from cs where coalesce(return_times, 0) > 0),
    'priorApproval', (select count(*) from cs where coalesce(prior_approval, '') not in ('', 'N', 'No', 'NO')),
    'settleDays', (select round(avg(settlement_date - dealer_submit_date), 1) from cs where settlement_date is not null and dealer_submit_date is not null),
    'submitDays', (select round(avg(dealer_submit_date - repair_end), 1) from cs where dealer_submit_date is not null and repair_end is not null),
    'statuses', (select coalesce(jsonb_agg(jsonb_build_object('label', s, 'n', n) order by n desc), '[]') from (select coalesce(status, '-') s, count(*) n from cs group by 1) x),
    'months', (
      select coalesce(jsonb_agg(jsonb_build_object('m', m, 'n', n, 'amount', a) order by m), '[]')
      from (select to_char(creation_date, 'YYYY-MM') m, count(*) n, round(sum(claim_amount)) a from cs group by 1) x
    ),
    'rejectedRegister', (select count(*) from self_audit_rejected_claims where (p_branch is null or branch_id = p_branch) and coalesce(rejection_date, created_at::date) >= (select y from yr)),
    'inquiries', jsonb_build_object(
      'total', (select count(*) from ti),
      'open', (select count(*) from ti where status not in ('closed', 'resolved')),
      'firstResponseHours', (select round(avg(extract(epoch from first_response_at - created_at) / 3600)::numeric, 1) from ti where first_response_at is not null)
    ),
    'verifications', jsonb_build_object(
      'total', (select count(*) from vr),
      'open', (select count(*) from vr where status <> 'closed')
    )
  ),
  'room', jsonb_build_object(
    'cycle', (select cycle_month from wrc),
    'flaggedClaims', (select count(*) from self_audit_scrap_requests sr where (p_branch is null or sr.branch_id = p_branch) and sr.status = 'pending'),
    'flaggedParts', (select count(*) from self_audit_scrap_requests sr join self_audit_scrap_request_parts p on p.scrap_request_id = sr.id where (p_branch is null or sr.branch_id = p_branch) and sr.status = 'pending'),
    'scrappedThisCycle', (select count(*) from self_audit_scrap_requests sr join self_audit_scrap_request_parts p on p.scrap_request_id = sr.id where (p_branch is null or sr.branch_id = p_branch) and sr.cycle_id = (select id from wrc) and sr.status = 'scrapped'),
    'scrappedYear', (select count(*) from self_audit_scrap_requests sr join self_audit_scrap_request_parts p on p.scrap_request_id = sr.id where (p_branch is null or sr.branch_id = p_branch) and sr.status = 'scrapped' and sr.submitted_at >= (select y from yr)),
    'evidence', jsonb_build_object(
      'approved', (select count(*) from self_audit_destroy_evidence e where e.cycle_id = (select id from wrc) and (p_branch is null or e.branch_id = p_branch) and e.status = 'sent'),
      'waiting', (select count(*) from self_audit_destroy_evidence e where e.cycle_id = (select id from wrc) and (p_branch is null or e.branch_id = p_branch) and e.status = 'submitted')
    ),
    'returnsOpen', (select count(*) from self_audit_part_returns where (p_branch is null or branch_id = p_branch) and closed_at is null),
    'returnsClosed', (select count(*) from self_audit_part_returns where (p_branch is null or branch_id = p_branch) and closed_at >= (select y from yr)),
    'collectionsOpen', (select count(*) from self_audit_supplier_collections where (p_branch is null or branch_id = p_branch) and handed_over_at is null),
    'collectionsDone', (select count(*) from self_audit_supplier_collections where (p_branch is null or branch_id = p_branch) and handed_over_at >= (select y from yr))
  ),
  'audit', jsonb_build_object(
    'cycle', (select cycle_month from ac),
    'cycleStatus', (select status::text from ac),
    'deadline', (select deadline_at from ac),
    'assignments', (select count(*) from self_audit_audit_assignments a where a.cycle_id = (select id from ac) and (p_branch is null or a.branch_id = p_branch)),
    'done', (select count(*) from self_audit_audit_assignments a where a.cycle_id = (select id from ac) and (p_branch is null or a.branch_id = p_branch) and a.status in ('submitted', 'ai_checked', 'reviewed')),
    'reviewed', (select count(*) from self_audit_audit_assignments a where a.cycle_id = (select id from ac) and (p_branch is null or a.branch_id = p_branch) and a.status = 'reviewed'),
    'score', (select round(avg(score_pct), 1) from self_audit_audit_results r where r.cycle_id = (select id from ac) and (p_branch is null or r.branch_id = p_branch)),
    'opsSubmitted', (select count(*) from self_audit_branch_operation_progress o where o.cycle_id = (select id from ac) and (p_branch is null or o.branch_id = p_branch) and o.status <> 'not_started'),
    'internal', jsonb_build_object(
      'count', (select count(*) from self_audit_internal_audits i where (p_branch is null or i.branch_id = p_branch) and i.status = 'finalized' and coalesce(i.audit_date, i.created_at::date) >= (select y from yr)),
      'score', (select round(avg(score_pct), 1) from self_audit_internal_audits i where (p_branch is null or i.branch_id = p_branch) and i.status = 'finalized' and coalesce(i.audit_date, i.created_at::date) >= (select y from yr)),
      'last', (select max(coalesce(i.audit_date, i.created_at::date)) from self_audit_internal_audits i where (p_branch is null or i.branch_id = p_branch) and i.status = 'finalized')
    ),
    'scores', (
      select coalesce(jsonb_agg(jsonb_build_object('m', m, 'score', s) order by m), '[]')
      from (
        select to_char(c.cycle_month, 'YYYY-MM') m, round(avg(r.score_pct), 1) s
        from self_audit_audit_results r join self_audit_audit_cycles c on c.id = r.cycle_id
        where (p_branch is null or r.branch_id = p_branch) and c.cycle_month >= (select y from yr) - interval '6 months'
        group by 1
      ) x
    )
  ),
  'customers', jsonb_build_object(
    'today', (select count(*) from qt),
    'waiting', (select count(*) from qt where status in ('waiting', 'held')),
    'served', (select count(*) from qt where status in ('in_service', 'completed')),
    'noShow', (select count(*) from qt where status = 'no_show'),
    'avgWait', (select round(avg(extract(epoch from served_at - queue_entry_at) / 60)::numeric, 0) from qt where served_at is not null and queue_entry_at is not null),
    'appointments', (select count(*) from self_audit_queue_appointments a where (p_branch is null or a.branch_id = p_branch) and a.appt_date = (select d from today))
  ),
  'complaints', jsonb_build_object(
    'total', (select count(*) from cmp),
    'open', (select count(*) from cmp where coalesce(status, '') <> 'Closed'),
    'valid', (select count(*) from cmp where lower(validity) = 'valid'),
    'notValid', (select count(*) from cmp where lower(validity) = 'not valid'),
    'resolveDays', (select round(avg(resolved_on - created_on), 1) from cmp where resolved_on is not null),
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('label', c, 'n', n) order by n desc), '[]') from (select coalesce(nullif(category, ''), '-') c, count(*) n from cmp group by 1 order by 2 desc limit 6) x),
    'sources', (select coalesce(jsonb_agg(jsonb_build_object('label', s, 'n', n) order by n desc), '[]') from (select coalesce(source, '-') s, count(*) n from cmp group by 1) x)
  )
);
$function$;

revoke all on function public.business_town(uuid) from public, anon, authenticated;
