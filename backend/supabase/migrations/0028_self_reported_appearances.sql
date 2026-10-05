-- Weight Cut AI — let a claimed fighter add their own fight history.
--
-- Every fighter_appearances row until now came from the offline scraper
-- (0011's module comment: "not app-user data"). Real gap, per Jean
-- directly: a fighter's actual career includes fights no promotion in this
-- database has scraped yet, or ever will (a local amateur show, a very
-- recent card, a promotion outside the ones covered). This lets a claimed
-- fighter add those themselves, alongside the scraped rows.
--
-- Kept clearly separate from scraped data rather than indistinguishable
-- from it: `is_self_reported` marks these so the UI can badge them
-- differently. This is a public fight-record directory people search for
-- real information, not a place where anything typed in silently reads as
-- verified the same way sourced data does.
--
-- source_url was `not null` (0011) because every prior row genuinely had
-- one (the scraped page it came from). A self-reported row has no such
-- source, so this relaxes that rather than inventing a fake URL.

alter table fighter_appearances alter column source_url drop not null;
alter table fighter_appearances add column if not exists is_self_reported boolean not null default false;
alter table fighter_appearances add column if not exists reported_by_user_id uuid references auth.users(id) on delete set null;

create index if not exists idx_fighter_appearances_reported_by on fighter_appearances(reported_by_user_id) where is_self_reported;

-- p_slug is explicit, not inferred from "the caller's claimed fighter" --
-- a user can claim more than one fighter row (nothing in 0019 prevented
-- that), so "which profile" has to come from which screen the caller is
-- actually on, same as update_fighter_profile's own p_slug parameter.
create or replace function add_self_reported_appearance(
  p_slug text,
  p_promotion text,
  p_event_name text,
  p_event_date date,
  p_weight_kg numeric,
  p_opponent_name text,
  p_opponent_slug text,
  p_result text,
  p_discipline text default 'Muay Thai'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fighter_name text;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  select name into v_fighter_name
  from fighters
  where slug = p_slug and claimed_by_user_id = auth.uid();

  if v_fighter_name is null then
    raise exception 'You can only add fight history to a profile you have claimed.';
  end if;

  if p_result not in ('win', 'loss', 'pending') then
    raise exception 'Invalid result.';
  end if;

  if trim(coalesce(p_opponent_name, '')) = '' then
    raise exception 'Opponent name is required.';
  end if;

  insert into fighter_appearances (
    promotion, event_name, event_date, discipline, weight_kg,
    fighter_name, fighter_slug, opponent_name, opponent_slug,
    result, source_url, is_self_reported, reported_by_user_id
  ) values (
    coalesce(nullif(trim(p_promotion), ''), 'Self-reported'),
    coalesce(nullif(trim(p_event_name), ''), 'Self-reported fight'),
    p_event_date,
    coalesce(nullif(trim(p_discipline), ''), 'Muay Thai'),
    p_weight_kg,
    v_fighter_name,
    p_slug,
    trim(p_opponent_name),
    nullif(trim(coalesce(p_opponent_slug, '')), ''),
    p_result,
    null,
    true,
    auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function add_self_reported_appearance(text, text, text, date, numeric, text, text, text, text) from public;
grant execute on function add_self_reported_appearance(text, text, text, date, numeric, text, text, text, text) to authenticated;

-- Scoped to rows the caller themselves reported (reported_by_user_id),
-- not to "rows on a fighter the caller currently has claimed" -- correct
-- even if a claim changes hands later, and never touches a scraped row
-- regardless (is_self_reported = true is required either way).
create or replace function delete_self_reported_appearance(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from fighter_appearances
  where id = p_id and is_self_reported = true and reported_by_user_id = auth.uid();
end;
$$;

revoke all on function delete_self_reported_appearance(uuid) from public;
grant execute on function delete_self_reported_appearance(uuid) to authenticated;
