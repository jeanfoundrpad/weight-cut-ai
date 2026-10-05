-- Weight Cut AI — widen the fighter_appearances identity key to include
-- event_date, not just (event_name, fighter_name, opponent_name).
--
-- Flagged by a Fable 5 code audit: the original key (0011) was date-blind.
-- A promotion that reuses an event name across different years (a real
-- pattern already seen in this data -- "Warriors Cup", "Fight Time
-- Championship" etc. number their shows, but plenty of one-off event names
-- like "Friday Night Fights" repeat) would upsert two genuinely different
-- events into the same row, silently overwriting one event's bout with
-- another's, since the scraper's Prefer: resolution=merge-duplicates
-- header means a conflicting insert always wins over what was there.
--
-- event_date stays nullable (a handful of rows may not have one), so this
-- doesn't retroactively fix identity for those -- but it closes the gap
-- for every row that does have a real date, which is nearly all of them.

alter table fighter_appearances drop constraint if exists fighter_appearances_event_name_fighter_name_opponent_name_key;

alter table fighter_appearances
  add constraint fighter_appearances_event_name_date_fighter_opponent_key
  unique (event_name, event_date, fighter_name, opponent_name);
