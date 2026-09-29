-- Warranty Room redesign: scrap-eligibility is now computed directly from
-- the All Claims Data upload (Verification Date + a 90-day holding period)
-- instead of requiring two separate manually-exported sheets ("Parts should
-- be scraped" / "Parts already scraped"). Officer no longer reviews/approves
-- destruction videos in-app either - the branch uploads a video and that's
-- the terminal state; the officer downloads it from the app and handles it
-- in a separate outside portal.

-- 1. Promote Verification Date from raw_row free text to a real column.
-- Backfilled from existing claims so already-uploaded data doesn't need a
-- re-upload to benefit. Same date-format guard as the do-not-scrap RPC
-- already used (raw_row->>'Verification Date' is always 'YYYY-MM-DD...').
alter table public.self_audit_claims add column verification_date date;

update public.self_audit_claims
set verification_date = substring(raw_row->>'Verification Date' from 1 for 10)::date
where (raw_row->>'Verification Date') ~ '^\d{4}-\d{2}-\d{2}';

create index self_audit_claims_verification_date_idx
  on public.self_audit_claims (verification_date)
  where verification_date is not null;

-- 2. Existing self_audit_scrap_requests rows are all 'pending_branch' today
-- (confirmed live - no rows mid-review), so this collapse is a clean rename,
-- not a data migration. New model: 'pending' (awaiting branch destruction +
-- video) -> 'scrapped' (video uploaded, terminal - this is also the
-- "already scrapped" record going forward, same role self_audit_scrapped_parts
-- played for pre-app history).
-- Drop the old constraint BEFORE remapping values - 'pending' isn't in the
-- old 8-value list, so updating to it first would violate the constraint
-- still in force (confirmed live: this exact ordering mistake failed once).
alter table public.self_audit_scrap_requests drop constraint self_audit_scrap_requests_status_check;
update public.self_audit_scrap_requests set status = 'pending' where status = 'pending_branch';
alter table public.self_audit_scrap_requests add constraint self_audit_scrap_requests_status_check
  check (status in ('pending', 'scrapped'));
alter table public.self_audit_scrap_requests alter column status set default 'pending';

drop function if exists public.decide_scrap_request(uuid, text, text);

create or replace function public.submit_scrap_request(
  p_scrap_request_id uuid,
  p_video_path text
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text;
  v_branch_id uuid;
begin
  if current_user_role() <> 'branch_admin' then
    raise exception 'Only a branch admin can submit a scrap request.';
  end if;

  select status, branch_id into v_status, v_branch_id
  from self_audit_scrap_requests where id = p_scrap_request_id;

  if v_status is null then
    raise exception 'Scrap request not found.';
  end if;
  if v_branch_id is distinct from current_user_branch_id() then
    raise exception 'This scrap request does not belong to your branch.';
  end if;
  if v_status <> 'pending' then
    raise exception 'This scrap request is not awaiting branch submission.';
  end if;
  if p_video_path is null or p_video_path = '' then
    raise exception 'A video is required before submitting.';
  end if;

  update self_audit_scrap_requests
  set status = 'scrapped', video_path = p_video_path, submitted_at = now()
  where id = p_scrap_request_id;

  insert into self_audit_scrap_request_events (scrap_request_id, event_type, actor_id, comment)
  values (p_scrap_request_id, 'branch_submitted', auth.uid(), null);
end;
$$;

-- 3. Auto-generates scrap requests from claims that just crossed the 90-day
-- holding period, called once by the client right after every claims upload
-- finishes. Verification Date only counts once the claim has reached a
-- stage where it's meaningful (Approved / Settled / To Be Settled) - same
-- gate src/lib/warranty-room/supplier-overdue.ts already uses for the
-- identical reasoning. Deliberately does NOT re-check the Draft
-- saved/Rejected/Closed/*returned* exclusions used elsewhere
-- (isExcludedClaimStatus) - that exclusion set and this allow-list
-- (approved/settled/to be settled) can never both be true for the same row,
-- so it's already implied.
--
-- Mirrors the part-matching/fallback/reserved-parts-subtraction logic the
-- old sheet-driven upsertScrapRequestsChunk used (main-part fallback when a
-- claim has no self_audit_claim_parts rows yet; subtract anything already
-- reserved for the supplier) - that logic is proven, only the candidate
-- SOURCE changed (computed here instead of read from an uploaded sheet).
-- Also excludes claims already in self_audit_scrapped_parts - 70,000+ real
-- historical rows recording what was scrapped before this automation
-- existed; skipping them here stops them from being wrongly re-flagged.
create or replace function public.generate_scrap_requests()
returns integer
language plpgsql
as $$
declare
  v_created integer;
begin
  if current_user_role() <> 'officer' then
    raise exception 'Not authorized.';
  end if;

  create temporary table tmp_scrap_candidates on commit drop as
  select
    c.id as claim_id,
    c.branch_id,
    c.work_order_no,
    c.labor_code as main_labor_code,
    c.verification_date as settlement_date,
    (current_date - c.verification_date) as holding_period_days,
    coalesce(
      (select jsonb_agg(jsonb_build_object('part_no', cp.part_no, 'part_name', cp.part_name, 'quantity', cp.quantity))
       from self_audit_claim_parts cp where cp.claim_id = c.id),
      case when c.main_part_name is not null or (c.raw_row->>'Main Part') is not null
        then jsonb_build_array(jsonb_build_object(
          'part_no', coalesce(c.raw_row->>'Main Part', c.raw_row->>'Part Number', c.raw_row->>'Part No', c.raw_row->>'Part Code'),
          'part_name', c.main_part_name,
          'quantity', null
        ))
        else '[]'::jsonb
      end
    ) as candidate_parts
  from self_audit_claims c
  where c.has_parts = true
    and c.verification_date is not null
    and lower(c.raw_row->>'Status') in ('approved', 'settled', 'to be settled')
    and (current_date - c.verification_date) >= 90
    and not exists (select 1 from self_audit_scrap_requests sr where sr.claim_id = c.id)
    and not exists (select 1 from self_audit_scrapped_parts sp where sp.claim_id = c.id);

  -- Subtract parts already reserved for the supplier - a part earmarked for
  -- pickup is never scrapped, regardless of the collection's own status.
  create temporary table tmp_scrap_requests on commit drop as
  select
    t.claim_id, t.branch_id, t.work_order_no, t.main_labor_code, t.settlement_date, t.holding_period_days,
    (
      select jsonb_agg(part) from jsonb_array_elements(t.candidate_parts) part
      where not exists (
        select 1 from self_audit_supplier_collection_parts scp
        where scp.claim_id = t.claim_id and scp.part_no = part->>'part_no'
      )
    ) as remaining_parts
  from tmp_scrap_candidates t;

  with ins as (
    insert into self_audit_scrap_requests (claim_id, branch_id, work_order_no, main_labor_code, settlement_date, holding_period_days, status)
    select claim_id, branch_id, work_order_no, main_labor_code, settlement_date, holding_period_days, 'pending'
    from tmp_scrap_requests
    where remaining_parts is not null and jsonb_array_length(remaining_parts) > 0
    on conflict (claim_id) do nothing
    returning id, claim_id
  )
  insert into self_audit_scrap_request_parts (scrap_request_id, part_no, part_name, quantity)
  select ins.id, p->>'part_no', p->>'part_name', nullif(p->>'quantity', '')::integer
  from ins
  join tmp_scrap_requests t on t.claim_id = ins.claim_id
  cross join lateral jsonb_array_elements(t.remaining_parts) p
  where p->>'part_no' is not null;

  select count(*) into v_created from tmp_scrap_requests
  where remaining_parts is not null and jsonb_array_length(remaining_parts) > 0;

  drop table tmp_scrap_candidates;
  drop table tmp_scrap_requests;
  return v_created;
end;
$$;

-- 4. get_do_not_scrap_claims now reads the typed verification_date column
-- instead of parsing raw_row with a regex every call. Exclusion shape is
-- unchanged (still skips anything already in self_audit_scrap_requests or
-- self_audit_scrapped_parts, still excludes the same statuses) - only the
-- source of holding_period_days changed.
create or replace function public.get_do_not_scrap_claims(p_branch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if current_user_role() = 'branch_admin' and p_branch_id is distinct from current_user_branch_id() then
    raise exception 'You can only view your own branch.';
  elsif current_user_role() not in ('officer', 'branch_admin') then
    raise exception 'Not authorized.';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'claim_number', x.claim_number,
      'work_order_no', x.work_order_no,
      'vin', x.vin,
      'vehicle_series', x.vehicle_series,
      'part_no', x.part_no,
      'part_name', x.part_name,
      'quantity', x.quantity,
      'creation_date', x.creation_date,
      'repair_end_date', x.repair_end_date,
      'first_submit_date', x.first_submit_date,
      'holding_period_days', x.holding_period_days
    ) order by x.creation_date desc, x.claim_number, x.part_no nulls last)
    from (
      select
        c.claim_number,
        c.work_order_no,
        c.vin,
        c.raw_row->>'Vehicle Series' as vehicle_series,
        cp.part_no,
        coalesce(cp.part_name, c.main_part_name) as part_name,
        cp.quantity,
        c.creation_date,
        c.repair_end_date,
        c.raw_row->>'First Submit Date' as first_submit_date,
        case
          when c.verification_date is not null then current_date - c.verification_date
          else null
        end as holding_period_days
      from self_audit_claims c
      left join self_audit_claim_parts cp on cp.claim_id = c.id
      where c.branch_id = p_branch_id
        and c.has_parts = true
        and not exists (select 1 from self_audit_scrap_requests sr where sr.claim_id = c.id)
        and not exists (select 1 from self_audit_scrapped_parts sp where sp.claim_id = c.id)
        and c.raw_row->>'Status' is distinct from 'Closed'
        and c.raw_row->>'Status' is distinct from 'Rejected'
        and c.raw_row->>'Status' is distinct from 'Draft saved'
        and not (c.raw_row->>'Status' = 'Returned from chief agent' and c.raw_row->>'Verification Date' is null)
    ) x
  ), '[]'::jsonb);
end;
$$;
