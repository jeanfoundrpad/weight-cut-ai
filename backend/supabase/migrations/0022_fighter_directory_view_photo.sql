-- Weight Cut AI — expose photo_url through the view. Appended at the end
-- of the SELECT list, same reasoning as 0015/0017 (CREATE OR REPLACE VIEW
-- rejects reordering existing columns).

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
  f.claimed_by_user_id,
  f.photo_url
from fighters f
left join lateral (
  select fa.promotion, fa.event_name, fa.event_date
  from fighter_appearances fa
  where fa.fighter_slug = f.slug
  order by fa.event_date desc nulls last
  limit 1
) a on true;
