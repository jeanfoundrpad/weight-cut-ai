-- Weight Cut AI — expose wins/losses/draws through the view. Appended at
-- the end of the SELECT list, same reasoning as 0015 (CREATE OR REPLACE
-- VIEW rejects reordering existing columns).

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
  f.draws
from fighters f
left join lateral (
  select fa.promotion, fa.event_name, fa.event_date
  from fighter_appearances fa
  where fa.fighter_name = f.name
  order by fa.event_date desc nulls last
  limit 1
) a on true;
