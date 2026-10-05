-- Weight Cut AI — fixes from a Fable 5 review of 0040's update_appearance_result.
--
-- Real bug found: update_appearance_result never marked the rows it
-- touched as unverified. Two consequences, both real:
-- 1. queue_result_notification's trigger (0030) fires on any pending ->
--    win/loss transition unless is_self_reported is true -- so resolving
--    your own pending fight queued "Your result is in" back to yourself,
--    and an identically-worded, identically-weighted push to your
--    opponent asserting a result they never confirmed.
-- 2. The "Self-reported" badge (app/fighter/[slug].tsx) never showed, so
--    a self-resolved result was visually indistinguishable from a real
--    scraper-verified one.
--
-- The fix is deliberately NOT "set is_self_reported = true" (the review's
-- literal suggestion) -- that flag also controls
-- delete_self_reported_appearance's scope (0028), so reusing it here
-- would let the caller later delete real scraped bout history, not just
-- undo their own result correction. Real scraped data disappearing
-- because someone typed in its outcome would be a worse bug than the one
-- being fixed. A separate, narrowly-scoped column keeps "this row's
-- OUTCOME is unverified" from also meaning "this row is fabricated data
-- eligible for deletion."
alter table fighter_appearances add column if not exists result_reported_by_user_id uuid references auth.users(id) on delete set null;

create or replace function queue_result_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_fighter_name text;
begin
  if new.is_self_reported or new.result_reported_by_user_id is not null
     or old.result <> 'pending' or new.result not in ('win', 'loss', 'draw') then
    return new;
  end if;

  select claimed_by_user_id, name into v_user_id, v_fighter_name
  from fighters
  where slug = new.fighter_slug;

  if v_user_id is null then
    return new;
  end if;

  insert into push_notification_outbox (user_id, title, body, data)
  values (
    v_user_id,
    'Your result is in',
    format('%s vs %s at %s: %s', v_fighter_name, new.opponent_name, new.event_name, upper(new.result)),
    jsonb_build_object('appearanceId', new.id, 'fighterSlug', new.fighter_slug)
  );

  return new;
end;
$$;

-- update_appearance_result itself: mark result_reported_by_user_id on
-- both sides of the pair it touches (the caller's own row and the
-- mirrored opponent row), same ownership gate as 0040, unchanged.
create or replace function update_appearance_result(p_id uuid, p_result text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row fighter_appearances;
  v_inverse text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  if p_result not in ('win', 'loss', 'draw') then
    raise exception 'Invalid result.';
  end if;

  select fa.* into v_row
  from fighter_appearances fa
  join fighters f on f.slug = fa.fighter_slug
  where fa.id = p_id and fa.result = 'pending' and f.claimed_by_user_id = auth.uid();

  if v_row.id is null then
    raise exception 'You can only update a pending fight on a profile you have claimed.';
  end if;

  update fighter_appearances
  set result = p_result, result_reported_by_user_id = auth.uid()
  where id = p_id;

  if v_row.opponent_slug is not null then
    v_inverse := case p_result when 'win' then 'loss' when 'loss' then 'win' else 'draw' end;
    update fighter_appearances
    set result = v_inverse, result_reported_by_user_id = auth.uid()
    where fighter_slug = v_row.opponent_slug and opponent_slug = v_row.fighter_slug
      and event_name = v_row.event_name and event_date is not distinct from v_row.event_date
      and result = 'pending';
  end if;
end;
$$;
