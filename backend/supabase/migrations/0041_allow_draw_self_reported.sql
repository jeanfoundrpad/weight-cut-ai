-- Weight Cut AI — add_self_reported_appearance (0028) only ever allowed
-- 'win', 'loss', 'pending', missed the same 'draw' gap 0039 just fixed on
-- the result column itself. A fighter adding their own fight history
-- should be able to say it was a draw, not force it into win or loss.
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

  if p_result not in ('win', 'loss', 'draw', 'pending') then
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
