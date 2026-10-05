-- Weight Cut AI — two new browse surfaces for the Fighters tab: gyms and
-- upcoming fights. Both are pure read views over data that already
-- exists (fighters.gym, fighter_appearances) -- no new writes, no new
-- tables, just new ways into the same directory.

-- One row per gym, most fighters first -- feeds a "Browse gyms" section
-- and each gym's own roster page. security_invoker so this respects
-- fighters' own SELECT policy (0012), same reasoning as every other view
-- in this schema (fighter_directory, trending_fighters).
create or replace view gyms_summary
with (security_invoker = true) as
select gym, count(*) as fighter_count
from fighters
where gym is not null and trim(gym) <> ''
group by gym
order by fighter_count desc, gym asc;

-- One row per real upcoming bout, not per fighter-side row -- a bout is
-- two fighter_appearances rows (one per side, see 0011's module comment),
-- so a naive select would show every card twice. Deduped via DISTINCT ON
-- an unordered pair of slugs within the same event, then re-sorted
-- chronologically in the outer query (DISTINCT ON requires its own
-- ORDER BY prefix, which isn't the chronological order this needs to
-- return in, hence the two-step subquery rather than one flat query).
-- Legacy rows with a null opponent_slug (scraped before that column
-- existed, see 0024) won't dedupe against their pair, which just means
-- an occasional duplicate for old data rather than a crash -- acceptable,
-- new rows all have it.
create or replace view upcoming_fights
with (security_invoker = true) as
select * from (
  select distinct on (
    event_name, event_date,
    least(coalesce(fighter_slug, ''), coalesce(opponent_slug, '')),
    greatest(coalesce(fighter_slug, ''), coalesce(opponent_slug, ''))
  )
    id, promotion, event_name, event_date, fighter_name, fighter_slug, opponent_name, opponent_slug, weight_kg
  from fighter_appearances
  where result = 'pending' and event_date is not null and event_date >= current_date
  order by
    event_name, event_date,
    least(coalesce(fighter_slug, ''), coalesce(opponent_slug, '')),
    greatest(coalesce(fighter_slug, ''), coalesce(opponent_slug, ''))
) as deduped_bouts
order by event_date asc;
