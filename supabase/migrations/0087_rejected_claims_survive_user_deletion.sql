-- The diary is a permanent record, but deleting a user account (a branch admin
-- who left, say) must still work and must keep everything they wrote.
--
-- The first version of the lock rejected EVERY update, including the one the
-- database itself makes when a user is deleted (the foreign keys created_by /
-- author_id / uploaded_by are "set null"), so deleting such a user failed. Now an
-- update is allowed only if it changes nothing except clearing one of those three
-- person links; the written text, dates, work order, files and the author's name
-- (stored on the row when it was written) are untouched. Deletes stay blocked.

create or replace function public.rejected_claims_are_permanent()
returns trigger
language plpgsql
as $$
declare
  person_cols constant text[] := array['created_by', 'author_id', 'uploaded_by'];
  col text;
begin
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - person_cols) = (to_jsonb(old) - person_cols) then
      -- a person link may only be cleared (or left as it was), never pointed elsewhere
      foreach col in array person_cols loop
        if (to_jsonb(new) ->> col) is not null and (to_jsonb(new) ->> col) is distinct from (to_jsonb(old) ->> col) then
          raise exception 'The rejected claims diary is a permanent record - add a comment instead.';
        end if;
      end loop;
      return new;
    end if;
  end if;
  raise exception 'The rejected claims diary is a permanent record - add a comment instead.';
end;
$$;
