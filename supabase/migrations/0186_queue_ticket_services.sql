-- Customer queue tickets: more than one service (e.g. Quick Service and General Repair together), what the customer
-- added at the kiosk, and what they changed from the appointment sheet (shown to the advisor).
alter table self_audit_queue_tickets add column if not exists services text[];
alter table self_audit_queue_tickets add column if not exists customer_note text;
-- e.g. {"name": {"from": "Nawaf Talal", "to": "Nawaf T."}, "services": {"from": ["quick_service"], "to": ["quick_service", "general_repair"]}}
alter table self_audit_queue_tickets add column if not exists customer_changes jsonb;
