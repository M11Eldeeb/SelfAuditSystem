-- The payments tracker groups all claims by payment order / settlement order and finds the claims still waiting for a
-- settlement. Reading those fields from the wide raw_row takes about 30 s for 62,000 claims, so they are kept in a
-- narrow table, one row per claim, by a trigger on the claims table (only claims an upload changes are touched).
create table if not exists public.self_audit_claim_settlement (
  claim_id uuid primary key references public.self_audit_claims (id) on delete cascade,
  payment_order text,
  settlement_order text,
  settle_vat numeric(14, 2),
  first_submit date,
  settlement_date date,
  status text,
  claim_amount numeric(14, 2)
);
create index if not exists self_audit_claim_settlement_po_idx on public.self_audit_claim_settlement (payment_order);
alter table public.self_audit_claim_settlement enable row level security;
create policy "officers read claim settlement" on public.self_audit_claim_settlement for select using ((select current_user_role()::text) = 'officer');

create or replace function public.safe_date(v text)
returns date language plpgsql immutable as $$
begin
  return nullif(btrim(v), '')::date;
exception when others then
  return null;
end;
$$;

create or replace function public.safe_numeric(v text)
returns numeric language plpgsql immutable as $$
begin
  return nullif(btrim(replace(v, ',', '')), '')::numeric;
exception when others then
  return null;
end;
$$;

create or replace function public.sync_claim_settlement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into self_audit_claim_settlement (claim_id, payment_order, settlement_order, settle_vat, first_submit, settlement_date, status, claim_amount)
  values (
    new.id,
    nullif(btrim(new.raw_row->>'Payment Order'), ''),
    nullif(btrim(new.raw_row->>'Settlement Order'), ''),
    safe_numeric(new.raw_row->>'Settle TOL.(VAT)'),
    safe_date(new.raw_row->>'First Submit Date'),
    safe_date(new.raw_row->>'Settlement Date'),
    nullif(btrim(new.raw_row->>'Status'), ''),
    new.claim_amount
  )
  on conflict (claim_id) do update set
    payment_order = excluded.payment_order,
    settlement_order = excluded.settlement_order,
    settle_vat = excluded.settle_vat,
    first_submit = excluded.first_submit,
    settlement_date = excluded.settlement_date,
    status = excluded.status,
    claim_amount = excluded.claim_amount;
  return null;
end;
$$;

drop trigger if exists claims_sync_settlement on public.self_audit_claims;
create trigger claims_sync_settlement after insert or update on public.self_audit_claims
  for each row execute function public.sync_claim_settlement();

-- Fill it once for the claims already uploaded.
insert into self_audit_claim_settlement (claim_id, payment_order, settlement_order, settle_vat, first_submit, settlement_date, status, claim_amount)
select id, nullif(btrim(raw_row->>'Payment Order'), ''), nullif(btrim(raw_row->>'Settlement Order'), ''), safe_numeric(raw_row->>'Settle TOL.(VAT)'),
       safe_date(raw_row->>'First Submit Date'), safe_date(raw_row->>'Settlement Date'), nullif(btrim(raw_row->>'Status'), ''), claim_amount
from self_audit_claims
on conflict (claim_id) do nothing;

-- The two reports now read the narrow table.
create or replace function public.payment_order_breakdown()
returns table (payment_order text, settlement_order text, claims bigint, settled numeric, avg_days numeric)
language sql stable security definer set search_path = public
as $$
  select payment_order, settlement_order, count(*), round(sum(settle_vat), 2), round(avg(settlement_date - first_submit)::numeric, 1)
  from self_audit_claim_settlement
  where payment_order is not null
  group by 1, 2;
$$;

create or replace function public.pending_settlement_by_month()
returns table (month text, claims bigint, amount numeric)
language sql stable security definer set search_path = public
as $$
  select to_char(first_submit, 'YYYY-MM'), count(*), round(sum(coalesce(claim_amount, 0)), 2)
  from self_audit_claim_settlement
  where settlement_order is null
    and first_submit is not null
    and coalesce(status, '') not in ('Rejected', 'Closed', 'Rejected from chief agent', 'Returned from chief agent')
  group by 1;
$$;
