-- Weight Cut AI — expose the new dated-snapshot fields through the view.
--
-- New columns appended at the end of the SELECT list, not inserted between
-- existing ones -- Postgres's CREATE OR REPLACE VIEW only allows adding
-- columns at the end; reordering existing ones is treated as a rename and
-- rejected (hit this directly: "cannot change name of view column
-- 'promotion' to 'division'" the first time this put them in the middle).

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
  f.as_of_date
from fighters f
left join lateral (
  select fa.promotion, fa.event_name, fa.event_date
  from fighter_appearances fa
  where fa.fighter_name = f.name
  order by fa.event_date desc nulls last
  limit 1
) a on true;
