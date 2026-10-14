-- Two more automatic mails get their on/off switch (both start OFF): the podium congratulations
-- and the internal audit notice.
insert into self_audit_mail_settings (key) values ('podium_congrats'), ('internal_audit_notice');
