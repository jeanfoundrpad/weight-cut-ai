-- Weight Cut AI — dated snapshot fields for richer sources.
--
-- No Boundary Fight's data (backend/scraper/scrape_noboundaryfight.py)
-- comes from a specific event's program PDF, not a continuously-updated
-- profile page like muaythairecords.com's "Last Weight" field. A
-- fighter's age/weight/record at one past event is a point-in-time fact,
-- not a claim about who they are right now — showing it without saying
-- when it's from risks looking wrong (or making someone justifiably
-- annoyed) the moment they've since moved weight classes, gone pro, or
-- fought again elsewhere. Hence `as_of_date`, always rendered alongside
-- these fields in the app rather than presented as current truth.
--
-- All nullable: only populated for sources that actually have this data
-- (division/age/height/as_of_date are No-Boundary-only for now; a
-- muaythairecords.com-sourced fighter just has these as null).

alter table fighters
  add column if not exists division text check (division in ('amateur', 'pro')),
  add column if not exists age integer,
  add column if not exists height text,
  add column if not exists as_of_date date;
