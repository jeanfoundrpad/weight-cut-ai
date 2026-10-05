-- Found by a Fable 5 security review (2026-08-10): analyze-photo's daily
-- scan cap was a plain check-then-insert (SELECT count(*) from scan_usage,
-- compare to the cap, call the paid AI provider, THEN insert the usage
-- row) with no transaction or lock between the check and the insert, and
-- the usage row was only ever written *after* the billed AI call
-- completed. N concurrent requests all read the same pre-insert count, all
-- pass the cap check, and all proceed to the metered call — the cap only
-- held under sequential traffic, not concurrent, which is exactly the
-- "expensive operation an attacker can hammer" case a security review is
-- supposed to catch.
--
-- Fixed by reserving a slot atomically, before the AI call, instead of
-- counting existing rows after it. `scan_slot_counters` is a lightweight
-- per-user/day/intent counter, incremented by reserve_scan_slot() via a
-- single `INSERT ... ON CONFLICT DO UPDATE ... WHERE count < max
-- RETURNING` statement — Postgres locks the conflicting row before
-- evaluating that WHERE clause, so concurrent callers for the same
-- user/day/intent serialize on the row lock rather than racing on a stale
-- read. release_scan_slot() gives the slot back on a failed AI call (e.g.
-- a transient provider error) so a network blip doesn't silently cost the
-- user one of their daily scans.
create table if not exists scan_slot_counters (
  user_id    uuid not null,
  local_date date not null,
  intent     text not null,
  count      integer not null default 0,
  primary key (user_id, local_date, intent)
);

alter table scan_slot_counters enable row level security;
-- No client-facing policies at all — only ever touched via the
-- security-definer functions below, same pattern as every other
-- tamper-sensitive table in this schema.

create or replace function reserve_scan_slot(p_intent text, p_max int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  insert into scan_slot_counters (user_id, local_date, intent, count)
  values (auth.uid(), current_date, p_intent, 1)
  on conflict (user_id, local_date, intent) do update
    set count = scan_slot_counters.count + 1
    where scan_slot_counters.count < p_max
  returning count into v_count;

  return v_count is not null;
end;
$$;

create or replace function release_scan_slot(p_intent text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update scan_slot_counters
  set count = greatest(0, count - 1)
  where user_id = auth.uid() and local_date = current_date and intent = p_intent;
end;
$$;

revoke all on function reserve_scan_slot(text, int) from public;
grant execute on function reserve_scan_slot(text, int) to authenticated;
revoke all on function release_scan_slot(text) from public;
grant execute on function release_scan_slot(text) to authenticated;
