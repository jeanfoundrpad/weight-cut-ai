-- Weight Cut AI — fix a real, 100%-reproducible group-creation bug found
-- during first live testing tonight.
--
-- createGroup() previously did a plain `insert().select().single()`. That
-- compiles to `INSERT ... RETURNING ...`, and Postgres RLS applies the
-- table's SELECT policy to the RETURNING output, not just the INSERT
-- policy's WITH CHECK. The "members can read their own groups" SELECT
-- policy on `groups` requires an existing group_members row — but that row
-- was only inserted on the *next* line, after RETURNING had already been
-- evaluated. Net effect: the groups row was created (a real, permanent,
-- orphaned row), the RETURNING select came back empty under RLS, the code
-- saw `error` and returned null before ever inserting the creator's own
-- membership row, and the group became permanently invisible to everyone,
-- including its own creator. This is the exact chicken-and-egg problem
-- join_group_by_code (0002_groups.sql) was already built to solve for
-- joining — it just was never applied to creating.

-- Direct client inserts into `groups` are no longer needed now that
-- creation goes through create_group() below — dropping this closes the
-- same broken path off entirely rather than leaving it available to hit by
-- accident (e.g. a future direct-insert call site reintroducing this bug).
drop policy if exists "any signed-in user can create a group" on groups;

create or replace function create_group(p_name text, p_invite_code text)
returns table (id uuid, name text, invite_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
begin
  if auth.uid() is null then
    return;
  end if;

  insert into groups (name, invite_code, created_by)
  values (p_name, upper(p_invite_code), auth.uid())
  returning groups.id into v_group_id;

  insert into group_members (group_id, user_id)
  values (v_group_id, auth.uid());

  return query
  select groups.id, groups.name, groups.invite_code
  from groups
  where groups.id = v_group_id;
end;
$$;

revoke all on function create_group(text, text) from public;
grant execute on function create_group(text, text) to authenticated;
