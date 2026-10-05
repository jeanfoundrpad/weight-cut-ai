-- Weight Cut AI — track which intent (log vs. suggest) each AI call was
-- for, so the two can be rate-limited separately. Without this, "suggest
-- meals" (a nice-to-have, browsable feature) could consume a user's entire
-- daily AI-call budget just from repeated experimentation, crowding out
-- their ability to log actual meals that day. Same overall cost ceiling as
-- before (the two sub-limits still sum to the old single limit), just
-- split so one feature can't starve the other.

alter table scan_usage add column if not exists intent text not null default 'log';
