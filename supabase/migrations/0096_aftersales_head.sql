-- Ahmed Mahmod, the aftersales head, becomes a named standing contact that any mail can copy
-- (second in the Cc line, right after the warranty head). Where he had been typed in as an extra Cc address
-- (the podium and internal-audit results mails), that is replaced by ticking the new option - same recipients.

alter table self_audit_mail_lists drop constraint self_audit_mail_lists_key_check;
alter table self_audit_mail_lists add constraint self_audit_mail_lists_key_check check (key in ('warranty_head', 'aftersales_head', 'standing_managers'));
insert into self_audit_mail_lists (key, emails) values ('aftersales_head', array['ahmed.mahmod@jiadmotors.com']);

update self_audit_mail_templates
set cc_groups = array['head', 'aftersales_head', 'officers', 'standing'],
    extra_cc = array_remove(extra_cc, 'ahmed.mahmod@jiadmotors.com')
where key = 'podium';

update self_audit_mail_templates
set cc_groups = array['head', 'aftersales_head', 'service_managers', 'officers'],
    extra_cc = array_remove(extra_cc, 'ahmed.mahmod@jiadmotors.com')
where key = 'results';
