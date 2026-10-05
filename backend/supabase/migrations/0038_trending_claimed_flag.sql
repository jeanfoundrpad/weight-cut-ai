-- Weight Cut AI — expose claimed_by_user_id on trending_fighters so the
-- Trending cards can show the same verified checkmark every other fighter
-- card shows for an admin-approved claim (0036). Appended, not
-- reordering existing columns, same CREATE OR REPLACE VIEW restriction
-- noted throughout this project's other view migrations.

create or replace view trending_fighters
with (security_invoker = true) as
with appearance_counts as (
  select fighter_slug, count(*) as cnt
  from fighter_appearances
  where event_date >= date_trunc('year', now())::date and event_date < date_trunc('year', now())::date + interval '1 year'
  group by fighter_slug
),
year_record_counts as (
  select fighter_slug, fights as cnt
  from fighter_year_records
  where year = extract(year from now())::int
)
select
  f.slug, f.name, f.gym, f.weight_kg, f.sex,
  greatest(coalesce(ac.cnt, 0), coalesce(yr.cnt, 0))::int as fights_this_year,
  f.claimed_by_user_id
from fighters f
left join appearance_counts ac on ac.fighter_slug = f.slug
left join year_record_counts yr on yr.fighter_slug = f.slug
where greatest(coalesce(ac.cnt, 0), coalesce(yr.cnt, 0)) > 0;
