-- Weight Cut AI — stable identity join + sex field.
--
-- Root cause of a real bug Jean spotted (the same real person, e.g.
-- "Connor Duffy" vs "Connor DUFFY", looking like two different people):
-- fighter_appearances.fighter_name is raw per-event extracted text, and
-- the two scrapers produce different casing for the same person (No
-- Boundary Fight's PDF layout separates a title-case first name from an
-- ALL-CAPS surname line; muaythairecords.com presents full names in
-- natural case). fighters.slug already canonicalizes identity correctly
-- (confirmed live: only one row exists for this person), but
-- fighter_directory's join matched on exact fighter_name text, which both
-- silently missed appearances with different casing AND let the raw,
-- inconsistently-cased text leak into places (like the Excel export) that
-- read fighter_appearances directly. Fixing this at the join key, not by
-- trying to normalize display text after the fact.
--
-- sex: only muaythairecords.com has real data for this (a schema.org
-- "gender" property embedded in each fighter's own page, verified to
-- actually vary per person — Female for Emily Crown/Gianna Vadino, Male
-- for David Lee/Christopher Cadet, not another generic identical value
-- like the Amateur/Pro dropdown false-positive found earlier). No
-- Boundary Fight's PDFs have no such field at all, so those fighters
-- simply have sex = null, per Jean's own "only add them if it says that."

alter table fighter_appearances
  add column if not exists fighter_slug text;

create index if not exists idx_fighter_appearances_slug on fighter_appearances(fighter_slug);

alter table fighters
  add column if not exists sex text check (sex in ('male', 'female'));
