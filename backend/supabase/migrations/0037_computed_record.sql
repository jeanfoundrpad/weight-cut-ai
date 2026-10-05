-- Weight Cut AI — a fighter's displayed record now comes from actually
-- counting their real appearance results, not a single scraped snapshot.
--
-- Jean noticed this directly: Dennis Dang showed "3 fights" in Trending
-- but "0-1" as his record. Investigated against real data before
-- assuming a bug -- both numbers were individually correct, just
-- measuring different things with no explanation shown together: 3 real
-- appearances logged this year, but 4 of his 5 total appearances are
-- still `result = 'pending'` (the source hasn't posted a verified
-- outcome yet), so only 1 has ever actually been decided. The "0-1" was
-- his own muaythairecords.com profile's separately-scraped total, which
-- happened to agree here but has no structural reason to always agree
-- with fighter_appearances -- two different sources, never reconciled.
--
-- Fixed by computing wins/losses/draws directly from fighter_appearances
-- (the same data Trending already uses, so the two numbers can't
-- disagree the way they did here) and adding a pending count alongside,
-- so "more fights than record" reads as self-explanatory instead of
-- looking broken. Deliberately only counts fighter_appearances (scraped
-- + individually self-reported bouts, both real `result` values per row)
-- -- not fighter_year_records' coarse yearly counts, which have no way
-- to be reconciled against individual bout rows without risking double
-- counting the same real fights twice.
--
-- Appended as new columns, not replacing wins/losses/draws in place --
-- CREATE OR REPLACE VIEW only allows appending, per the same restriction
-- hit earlier in this project (0015's "cannot change name of view column"
-- error) -- and the raw scraped fields still matter as a fallback for a
-- fighter with zero tracked appearances but a real declared record.

create or replace view fighter_directory
with (security_invoker = true) as
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
  f.photo_url,
  coalesce(rec.computed_wins, 0) as computed_wins,
  coalesce(rec.computed_losses, 0) as computed_losses,
  coalesce(rec.computed_draws, 0) as computed_draws,
  coalesce(rec.computed_pending, 0) as computed_pending
from fighters f
left join lateral (
  select fa.promotion, fa.event_name, fa.event_date
  from fighter_appearances fa
  where fa.fighter_slug = f.slug
  order by fa.event_date desc nulls last
  limit 1
) a on true
left join (
  select
    fighter_slug,
    count(*) filter (where result = 'win') as computed_wins,
    count(*) filter (where result = 'loss') as computed_losses,
    count(*) filter (where result = 'draw') as computed_draws,
    count(*) filter (where result = 'pending') as computed_pending
  from fighter_appearances
  group by fighter_slug
) rec on rec.fighter_slug = f.slug;
