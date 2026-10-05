-- Weight Cut AI — self-service profile editing for claimed fighters.
--
-- Once a fighter claims their scraped profile, they become the more
-- authoritative source for their own info than a past scrape snapshot --
-- Jean directly: "they will need the ability to update their info... add
-- pictures as well." Two security-definer RPCs, not a plain client-facing
-- UPDATE policy, matching claim_fighter/unclaim_fighter's own reasoning
-- (0019): a broad UPDATE policy applies to the whole row, not one column,
-- so it would let a claiming user rewrite slug/claimed_by_user_id/
-- source_url too, not just their own profile fields.
--
-- update_fighter_profile bumps as_of_date to today -- this repurposes the
-- same field the scrapers use (0014) for "when was this true," which
-- stays honest whether the source is a past event snapshot or the
-- fighter's own just-now edit.

create or replace function update_fighter_profile(
  p_slug text,
  p_gym text,
  p_weight_kg numeric,
  p_division text,
  p_age integer,
  p_height text,
  p_sex text,
  p_wins integer,
  p_losses integer,
  p_draws integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update fighters
  set
    gym = p_gym,
    weight_kg = p_weight_kg,
    division = p_division,
    age = p_age,
    height = p_height,
    sex = p_sex,
    wins = p_wins,
    losses = p_losses,
    draws = p_draws,
    as_of_date = current_date
  where slug = p_slug and claimed_by_user_id = auth.uid();

  if not found then
    raise exception 'You have not claimed this fighter.';
  end if;
end;
$$;

revoke all on function update_fighter_profile(text, text, numeric, text, integer, text, text, integer, integer, integer) from public;
grant execute on function update_fighter_profile(text, text, numeric, text, integer, text, text, integer, integer, integer) to authenticated;

create or replace function update_fighter_photo(p_slug text, p_photo_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update fighters
  set photo_url = p_photo_url
  where slug = p_slug and claimed_by_user_id = auth.uid();

  if not found then
    raise exception 'You have not claimed this fighter.';
  end if;
end;
$$;

revoke all on function update_fighter_photo(text, text) from public;
grant execute on function update_fighter_photo(text, text) to authenticated;

alter table fighters add column if not exists photo_url text;
