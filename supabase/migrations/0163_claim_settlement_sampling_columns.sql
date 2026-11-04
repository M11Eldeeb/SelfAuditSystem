-- Internal audit sampling reads the narrow claim settlement table only (the claims table is ~200 MB with raw_row and
-- timed out): the remaining fields the sampling and its risk flag use are kept here too, by the same trigger.
set local statement_timeout = '15min';

alter table self_audit_claim_settlement
  add column if not exists claim_number text,
  add column if not exists prior_approval text,
  add column if not exists return_times numeric,
  add column if not exists return_times_dealer numeric,
  add column if not exists creation_date date,
  add column if not exists dealer_submit_date date;
create index if not exists self_audit_claim_settlement_branch_idx on self_audit_claim_settlement (branch_id, dealer_submit_date);

create or replace function public.sync_claim_settlement()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  insert into self_audit_claim_settlement (claim_id, payment_order, settlement_order, settle_vat, first_submit, settlement_date, status, claim_amount,
                                           branch_id, repair_end, adjusted, labor_before, part_before, sublet_before,
                                           has_parts, verification_date, labor_code, work_order_no, main_part_name,
                                           claim_number, prior_approval, return_times, return_times_dealer, creation_date, dealer_submit_date)
  values (
    new.id,
    nullif(btrim(new.raw_row->>'Payment Order'), ''),
    nullif(btrim(new.raw_row->>'Settlement Order'), ''),
    safe_numeric(new.raw_row->>'Settle TOL.(VAT)'),
    safe_date(new.raw_row->>'First Submit Date'),
    safe_date(new.raw_row->>'Settlement Date'),
    nullif(btrim(new.raw_row->>'Status'), ''),
    new.claim_amount,
    new.branch_id,
    new.repair_end_date,
    safe_numeric(new.raw_row->>'Adjusted Claim TOL.'),
    safe_numeric(new.raw_row->>'Labor TOL. Before Adjustment'),
    safe_numeric(new.raw_row->>'Part TOL. Before Adjustment'),
    safe_numeric(new.raw_row->>'Sublet TOL.Before Adjustment'),
    new.has_parts,
    new.verification_date,
    new.labor_code,
    new.work_order_no,
    new.main_part_name,
    new.claim_number,
    new.prior_approval,
    new.return_times,
    new.return_times_dealer,
    new.creation_date,
    new.dealer_submit_date
  )
  on conflict (claim_id) do update set
    payment_order = excluded.payment_order,
    settlement_order = excluded.settlement_order,
    settle_vat = excluded.settle_vat,
    first_submit = excluded.first_submit,
    settlement_date = excluded.settlement_date,
    status = excluded.status,
    claim_amount = excluded.claim_amount,
    branch_id = excluded.branch_id,
    repair_end = excluded.repair_end,
    adjusted = excluded.adjusted,
    labor_before = excluded.labor_before,
    part_before = excluded.part_before,
    sublet_before = excluded.sublet_before,
    has_parts = excluded.has_parts,
    verification_date = excluded.verification_date,
    labor_code = excluded.labor_code,
    work_order_no = excluded.work_order_no,
    main_part_name = excluded.main_part_name,
    claim_number = excluded.claim_number,
    prior_approval = excluded.prior_approval,
    return_times = excluded.return_times,
    return_times_dealer = excluded.return_times_dealer,
    creation_date = excluded.creation_date,
    dealer_submit_date = excluded.dealer_submit_date;
  return null;
end;
$function$;

update self_audit_claim_settlement s
set claim_number = c.claim_number, prior_approval = c.prior_approval, return_times = c.return_times, return_times_dealer = c.return_times_dealer,
    creation_date = c.creation_date, dealer_submit_date = c.dealer_submit_date
from self_audit_claims c
where c.id = s.claim_id;
