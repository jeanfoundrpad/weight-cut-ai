-- Weight Cut AI — join on fighter_slug instead of exact name text, and
-- expose sex/claimed_by_user_id. Fixes the real bug where a fighter whose
-- appearance rows use a different casing than their canonical name
-- (e.g. "Connor Duffy" vs "Connor DUFFY") could silently fail to match
-- their own most-recent-appearance lookup.

create or replace view fighter_directory
  with (security_invoker = true)
  as
select
  f.slug,
  f.name,
  f.gym,
  f.weight_kg,
  a.promotion,
  a.event_name,
  a.event_date,
  f.division,
  f.age,
  f.height,
  f.as_of_date,
  f.wins,
  f.losses,
  f.draws,
  f.sex,
  f.claimed_by_user_id
from fighters f
left join lateral (
  select fa.promotion, fa.event_name, fa.event_date
  from fighter_appearances fa
  where fa.fighter_slug = f.slug
  order by fa.event_date desc nulls last
  limit 1
) a on true;
