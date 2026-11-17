-- Queue system: an account that only uses the customer queue (parts advisors, pickers, queue managers without another portal role).
alter type user_role add value if not exists 'queue_user';
