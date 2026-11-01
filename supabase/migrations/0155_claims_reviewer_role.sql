-- Technician claims reviewer: reviews the technician claims of one branch (approve / return / reject) and sees nothing else.
alter type user_role add value if not exists 'claims_reviewer';
