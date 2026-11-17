-- Data Analyst role (a new value must be committed before anything can use it: the next migration allows it without a branch).
alter type user_role add value if not exists 'data_analyst';
