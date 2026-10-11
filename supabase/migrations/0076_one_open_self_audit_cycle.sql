-- Only one self-audit cycle can be open at a time. Nothing used to close a
-- cycle, so the previous month's cycle stayed 'open' next to the new one and
-- the dashboard podium showed the old cycle's scores. Opening a cycle now
-- closes every other open one (trigger), and a unique index guarantees two
-- open cycles can never coexist, whatever code or SQL creates them.

create or replace function public.close_other_open_audit_cycles()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'open' then
    update self_audit_audit_cycles
    set status = 'completed'
    where status = 'open' and id <> new.id;
  end if;
  return new;
end;
$$;

create trigger close_other_open_audit_cycles
before insert or update of status on self_audit_audit_cycles
for each row execute function public.close_other_open_audit_cycles();

create unique index one_open_audit_cycle on self_audit_audit_cycles ((true)) where status = 'open';
