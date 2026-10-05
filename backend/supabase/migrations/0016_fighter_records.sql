-- Weight Cut AI — fight record (wins/losses/draws).
--
-- muaythairecords.com's own fighter profile presents "Record: W-L-D" as a
-- continuously-updated current total (same status as gym/weight there --
-- no as_of_date needed, matching how those two are already handled). No
-- Boundary Fight's record comes from one specific event's program PDF --
-- a dated snapshot like division/age/height, already covered by the
-- as_of_date column from 0014.

alter table fighters
  add column if not exists wins integer,
  add column if not exists losses integer,
  add column if not exists draws integer;
