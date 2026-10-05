-- Weight Cut AI — clickable opponent links.
--
-- Jean: "the database will be extremely important. When one click on
-- an[other] name... you should see who they fought." The fight-history
-- list already shows who someone fought (opponent_name), but it was
-- plain text -- no way to tap through to *that* person's own profile,
-- so the fight graph this data actually represents (fighter -> opponent
-- -> their own opponents) was never actually navigable, just displayed.
--
-- opponent_slug is captured by both scrapers at the same time as
-- fighter_slug (0018) -- every bout already resolves both fighters'
-- identities in the same pass, so this is free to add, not a new lookup.

alter table fighter_appearances
  add column if not exists opponent_slug text;

create index if not exists idx_fighter_appearances_opponent_slug on fighter_appearances(opponent_slug);
