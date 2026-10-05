-- Weight Cut AI — a claimed fighter can resolve their own pending fights.
--
-- 0028 already let a fighter add fights the scraper never found, but not
-- correct one it did find that's stuck `result = 'pending'` because the
-- source never published an outcome (confirmed real and common while
-- cleaning up historical data -- muaythairecords.com itself still says
-- "not yet verified" on fights from 2024). Jean, directly: "This is why I
-- want fighters to edit their own profile so they can update it."
--
-- Scoped narrowly on purpose: only a row still 'pending' can be touched
-- (correcting a genuinely wrong scraped win/loss is a different, harder
-- trust problem -- see fighter_claim_reports/0035's own reasoning for why
-- disputed data stays a manual reviewed action, not self-serve), and only
-- to 'win'/'loss'/'draw', never back to 'pending'.
--
-- Mirrors the result onto the paired opponent-side row (same bout, see
-- 0011's module comment: a bout is two fighter_appearances rows) when that
-- row is itself still pending, so both sides of the pair agree instead of
-- one side quietly diverging from the other. If the opponent has already
-- had their own side set to something else (another self-correction, or a
-- since-arrived scraped result), that row is left alone rather than
-- overwritten -- same "trust the row you're allowed to touch, don't touch
-- the one you're not" posture as everything else here.
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

  update fighter_appearances set result = p_result where id = p_id;

  if v_row.opponent_slug is not null then
    v_inverse := case p_result when 'win' then 'loss' when 'loss' then 'win' else 'draw' end;
    update fighter_appearances
    set result = v_inverse
    where fighter_slug = v_row.opponent_slug and opponent_slug = v_row.fighter_slug
      and event_name = v_row.event_name and event_date is not distinct from v_row.event_date
      and result = 'pending';
  end if;
end;
$$;

revoke all on function update_appearance_result(uuid, text) from public;
grant execute on function update_appearance_result(uuid, text) to authenticated;
