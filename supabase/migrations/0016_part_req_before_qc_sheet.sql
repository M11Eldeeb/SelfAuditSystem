-- Move Part Requisition ahead of QC Sheet in the Workshop question order.
update self_audit_audit_questions set sort_order = 11 where id = 'clockings';
update self_audit_audit_questions set sort_order = 12 where id = 'partReq';
