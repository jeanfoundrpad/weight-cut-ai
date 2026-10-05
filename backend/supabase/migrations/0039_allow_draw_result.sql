-- Weight Cut AI — fighter_appearances_result_check (0011) only ever
-- allowed 'win', 'loss', 'pending' -- 'draw' was never a legal value,
-- even though 0037's fighter_directory view already computes
-- computed_draws via `count(*) filter (where result = 'draw')`. That
-- filter has been silently matching zero rows for every fighter since
-- the day it was written, since no row could ever actually hold 'draw'.
-- Found while cleaning up historical scraped rows that had encoded a
-- draw result as a corrupted opponent name instead.
alter table fighter_appearances drop constraint fighter_appearances_result_check;
alter table fighter_appearances add constraint fighter_appearances_result_check
  check (result = any (array['win', 'loss', 'draw', 'pending']));
