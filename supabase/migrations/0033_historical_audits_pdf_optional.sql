-- Not every historical result has a surviving PDF - allow the entry without one.
alter table public.self_audit_historical_audits alter column pdf_path drop not null;
