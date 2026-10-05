-- Weight Cut AI — the "Upcoming fights" surface (0034) is removed from the
-- app per Jean directly. gyms_summary (also 0034) stays; only the
-- upcoming_fights view and its dedicated screen go.
drop view if exists upcoming_fights;
