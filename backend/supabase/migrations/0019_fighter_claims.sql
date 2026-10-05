-- Weight Cut AI — claim-your-profile.
--
-- Jean: "when people are first making their profiles, we will need an
-- option for them to allow them to claim their name." Lets a signed-in
-- app user link their account to a scraped fighter row, so their real
-- fight history shows as theirs inside the app.
--
-- No plain client-facing UPDATE policy on fighters: an UPDATE policy
-- applies to the whole row, not one column, so it would also let a
-- claiming user silently rewrite gym/weight/record on any unclaimed row.
-- Two security-definer RPCs instead (same pattern as join_group_by_code /
-- create_group / claim_referral elsewhere in this schema) that can only
-- ever touch claimed_by_user_id, and only under the exact condition that
-- makes the action valid.

alter table fighters
  add column if not exists claimed_by_user_id uuid references auth.users(id) on delete set null;

create index if not exists idx_fighters_claimed_by on fighters(claimed_by_user_id);

create or replace function claim_fighter(p_slug text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update fighters
  set claimed_by_user_id = auth.uid()
  where slug = p_slug and claimed_by_user_id is null;

  if not found then
    raise exception 'This fighter has already been claimed, or does not exist.';
  end if;
end;
$$;

revoke all on function claim_fighter(text) from public;
grant execute on function claim_fighter(text) to authenticated;

create or replace function unclaim_fighter(p_slug text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update fighters
  set claimed_by_user_id = null
  where slug = p_slug and claimed_by_user_id = auth.uid();

  if not found then
    raise exception 'You have not claimed this fighter.';
  end if;
end;
$$;

revoke all on function unclaim_fighter(text) from public;
grant execute on function unclaim_fighter(text) to authenticated;
