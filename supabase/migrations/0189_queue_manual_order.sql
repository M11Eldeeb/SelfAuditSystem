-- Customer queue: the reception manager moves a waiting customer to the front. Moved customers are called first, in the
-- order they were moved (pinned_at), before the automatic order; cleared when called or put back.
alter table self_audit_queue_tickets add column if not exists pinned_at timestamptz;
