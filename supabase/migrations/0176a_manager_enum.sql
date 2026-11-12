-- New account type "manager" (alone: a new enum value cannot be used in the transaction that adds it).
alter type user_role add value if not exists 'manager';
