-- Free service: sub_dealer_free_service_invoiced also returns what the dealer invoiced to account I1855 (the amount paid to the
-- sub-dealer, VAT excluded) on the same work order and VIN, as "paid" (null when no such line is invoiced yet). The Sub-Dealer
-- Warranty Desk used the sub-dealer's approved amount (VAT included) against the I660 invoice (VAT excluded), which
-- overstated what the dealer pays and understated the dealer's revenue by the VAT; the desk now takes "paid".
-- Additive: "invoiced" and "lines" are unchanged.
create or replace function public.sub_dealer_free_service_invoiced(p_secret text, p_items jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_secret text;
  v_item jsonb;
  v_out jsonb := '[]'::jsonb;
  v_wo text;
  v_wip text;
  v_vin text;
  v_branch text;
  v_amount numeric;
  v_lines integer;
  v_paid numeric;
  v_paid_lines integer;
begin
  select secret into v_secret from portal_link_secret where id = 1;
  if v_secret is null or p_secret is distinct from v_secret then
    raise exception 'not allowed';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 300 then
    raise exception 'bad request';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_wo := upper(trim(coalesce(v_item->>'work_order_no', '')));
    v_vin := upper(trim(coalesce(v_item->>'vin', '')));
    v_wip := substring(v_wo from '^[A-Z]{2,4}-([0-9]+)');
    -- dealer branch code of the work order prefix (same map as JIAD_DEALER_CODE_SUFFIX_MAP in the self-audit app)
    v_branch := case substring(v_wo from '^([A-Z]{2,4})-')
      when 'HER' then 'A7' when 'MRB' then 'B7' when 'RSS' then 'C7' when 'RNQ' then 'E7' when 'QSM' then 'F7'
      when 'DMM' then 'G7' when 'NKH' then 'I7' when 'MAD' then 'J7' when 'JZN' then 'K7' when 'ABH' then 'L7'
      when 'RKR' then 'P7' else null end;
    v_amount := null;
    v_lines := 0;
    v_paid := null;
    v_paid_lines := 0;
    if v_branch is not null and v_wip is not null and v_vin <> '' then
      select sum(d.amount), count(*) into v_amount, v_lines
      from self_audit_invoicing_detail d
      where d.vin = v_vin and d.wip = v_wip and d.branch = v_branch and d.account_code ~ '^I0*660$';
      select sum(d.amount), count(*) into v_paid, v_paid_lines
      from self_audit_invoicing_detail d
      where d.vin = v_vin and d.wip = v_wip and d.branch = v_branch and d.account_code ~ '^I0*1855$';
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'key', v_item->>'key',
      'invoiced', case when v_lines > 0 then v_amount end,
      'lines', v_lines,
      'paid', case when v_paid_lines > 0 then v_paid end
    ));
  end loop;

  return v_out;
end;
$$;
