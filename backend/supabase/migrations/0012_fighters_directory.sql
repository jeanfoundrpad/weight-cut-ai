-- Weight Cut AI — fighter directory (name, gym, weight lookup).
--
-- Jean's refined ask after seeing the first pass: not a bout-history feed
-- (no promotion/date/upcoming/win-loss), just a directory a fighter can
-- search or browse by weight to see who's out there and what gym they
-- train at. One row per unique fighter, sourced from their own profile
-- page on muaythairecords.com (gym and "last weight" only live there, not
-- on event pages — see backend/scraper/scrape_muaythairecords.py).
--
-- Separate from fighter_appearances (0011) on purpose: that table is
-- per-bout event history, this one is per-person current state. Different
-- shapes for different questions, not a redundant duplicate.

create table if not exists fighters (
  slug text primary key,
  name text not null,
  gym text,
  weight_kg numeric,
  source_url text not null,
  scraped_at timestamptz not null default now()
);

create index if not exists idx_fighters_weight on fighters(weight_kg);
create index if not exists idx_fighters_name on fighters(name);

alter table fighters enable row level security;

create policy "anyone signed in can browse the fighter directory"
  on fighters for select
  using (true);
