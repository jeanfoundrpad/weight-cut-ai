-- Found while building account deletion (Apple Guideline 5.1.1(v) requires
-- in-app self-service deletion, not just a support-email request): every
-- other user-scoped table already cascades on auth.users(id) deletion, but
-- scan_slot_counters (0008_atomic_scan_cap.sql) was created with a plain
-- `user_id uuid not null` and no foreign key at all — deleting a user
-- would have left orphaned counter rows behind indefinitely. Small and
-- low-stakes (just a rate-limit counter, no content), but a real gap and
-- inconsistent with how every other table in this schema already handles
-- account deletion via cascade.
alter table scan_slot_counters
  add constraint scan_slot_counters_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;
