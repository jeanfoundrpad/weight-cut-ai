-- Weight Cut AI — fighter directory + most recent fight/promotion.
--
-- Jean's follow-up after seeing the stripped-down directory: bring back
-- "recent fight stuff" and the promotion name (explicitly still not
-- win/loss). This needs one row per fighter (from `fighters`) joined to
-- that same fighter's single most recent bout (from `fighter_appearances`,
-- 0011) for its promotion/event/date -- a view rather than app-side
-- joins, so the client stays a single `.from('fighter_directory')` query
-- like everything else in fightersClient.ts.
--
-- security_invoker so this view runs under the querying user's own RLS
-- policies rather than the view owner's -- both underlying tables are
-- public-read already, so this isn't a live security gap either way, but
-- it's the correct default for any view over RLS-enabled tables.

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
  a.event_date
from fighters f
left join lateral (
  select fa.promotion, fa.event_name, fa.event_date
  from fighter_appearances fa
  where fa.fighter_name = f.name
  order by fa.event_date desc nulls last
  limit 1
) a on true;
