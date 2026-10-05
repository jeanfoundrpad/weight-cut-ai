-- Weight Cut AI — scraped fighter appearances (weight-class discovery).
--
-- Not app-user data: this is public sports data (fighter name, weight,
-- promotion, event, result) sourced from third-party fight-record sites by
-- an offline Python scraper (backend/scraper/), not written by any client.
-- The point, per Jean directly: let a fighter already using the app see
-- who else is fighting at their weight class right now — a discovery/
-- community draw, not a rankings ladder and not a promoter matchmaking
-- tool (those were explicitly ruled out as the goal).
--
-- One row per fighter per bout (so a 2-fighter bout is 2 rows, one from
-- each side) rather than one row per bout with two fighter columns — this
-- is what lets "show everyone who fought near 145 lbs recently" be a
-- single WHERE clause with no join, which is the actual browsing pattern
-- the app needs.
--
-- Public reference data, not per-user: readable by anyone signed into the
-- app, writable only by the scraper via the service-role key (same
-- write-only-by-service-role posture as subscription_status) — no client
-- role gets INSERT/UPDATE/DELETE, so this can only ever reflect what the
-- scraper actually found.

create table if not exists fighter_appearances (
  id uuid primary key default gen_random_uuid(),
  promotion text not null,
  event_name text not null,
  event_date date,
  discipline text not null default 'Muay Thai',
  weight_kg numeric not null,
  fighter_name text not null,
  opponent_name text not null,
  result text not null default 'pending' check (result in ('win', 'loss', 'pending')),
  method text,
  source_url text not null,
  scraped_at timestamptz not null default now(),
  unique (event_name, fighter_name, opponent_name)
);

create index if not exists idx_fighter_appearances_weight on fighter_appearances(weight_kg);
create index if not exists idx_fighter_appearances_fighter on fighter_appearances(fighter_name);

alter table fighter_appearances enable row level security;

create policy "anyone signed in can browse fighter appearances"
  on fighter_appearances for select
  using (true);
