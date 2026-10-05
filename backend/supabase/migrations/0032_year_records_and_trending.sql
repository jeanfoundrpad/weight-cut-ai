-- Weight Cut AI — yearly fight-count records, self-created profiles, and
-- a "Trending" activity signal, per Jean directly: fighters should be
-- able to add their record and how many fights they've had per year
-- during sign-up (and edit it later from their profile), and the
-- directory should surface who's been fighting a lot this year -- a
-- signal that "should get better as fighters log their fight manually."
--
-- Two distinct kinds of self-reported activity, on purpose:
-- fighter_appearances (0011/0028) is one row per real bout -- name,
-- opponent, event, date. Useful, but a lot to ask someone to reconstruct
-- for years of an amateur career. fighter_year_records is the coarser,
-- much lower-friction alternative: "I had 5 fights in 2023," no opponent
-- names required. Both feed the same "how active is this fighter"
-- signal (see trending_fighters below), so a fighter can use whichever
-- fits how much they remember.

-- A fighter who never appears in any scraped promotion currently has no
-- way to exist in `fighters` at all -- that table has only ever been
-- written by the scraper. source_url was `not null` because every prior
-- row genuinely had a source page; a self-created profile has none.
alter table fighters alter column source_url drop not null;
alter table fighters add column if not exists is_self_created boolean not null default false;

create table if not exists fighter_year_records (
  fighter_slug text not null references fighters(slug) on delete cascade,
  year int not null check (year between 1950 and 2100),
  fights int not null default 0 check (fights >= 0),
  wins int check (wins >= 0),
  losses int check (losses >= 0),
  draws int check (draws >= 0),
  updated_by_user_id uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (fighter_slug, year)
);

alter table fighter_year_records enable row level security;

create policy "anyone signed in can browse year records"
  on fighter_year_records for select
  using (true);

-- No client INSERT/UPDATE/DELETE policy -- only via the RPCs below, same
-- ownership-checked pattern as update_fighter_profile.

create or replace function create_and_claim_fighter(p_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base_slug text;
  v_slug text;
  v_suffix int := 1;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  if trim(coalesce(p_name, '')) = '' then
    raise exception 'Name is required.';
  end if;

  v_base_slug := trim(both '-' from regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '-', 'g'));
  if v_base_slug = '' then
    v_base_slug := 'fighter';
  end if;
  v_slug := v_base_slug;

  while exists (select 1 from fighters where slug = v_slug) loop
    v_suffix := v_suffix + 1;
    v_slug := v_base_slug || '-' || v_suffix;
  end loop;

  insert into fighters (slug, name, claimed_by_user_id, is_self_created, source_url)
  values (v_slug, trim(p_name), auth.uid(), true, null);

  return v_slug;
end;
$$;

revoke all on function create_and_claim_fighter(text) from public;
grant execute on function create_and_claim_fighter(text) to authenticated;

create or replace function upsert_fighter_year_record(
  p_slug text, p_year int, p_fights int, p_wins int, p_losses int, p_draws int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  if not exists (select 1 from fighters where slug = p_slug and claimed_by_user_id = auth.uid()) then
    raise exception 'You can only edit a profile you have claimed.';
  end if;

  insert into fighter_year_records (fighter_slug, year, fights, wins, losses, draws, updated_by_user_id, updated_at)
  values (p_slug, p_year, coalesce(p_fights, 0), p_wins, p_losses, p_draws, auth.uid(), now())
  on conflict (fighter_slug, year) do update set
    fights = excluded.fights, wins = excluded.wins, losses = excluded.losses, draws = excluded.draws,
    updated_by_user_id = excluded.updated_by_user_id, updated_at = excluded.updated_at;
end;
$$;

revoke all on function upsert_fighter_year_record(text, int, int, int, int, int) from public;
grant execute on function upsert_fighter_year_record(text, int, int, int, int, int) to authenticated;

create or replace function delete_fighter_year_record(p_slug text, p_year int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  delete from fighter_year_records
  where fighter_slug = p_slug and year = p_year
    and exists (select 1 from fighters where slug = p_slug and claimed_by_user_id = auth.uid());
end;
$$;

revoke all on function delete_fighter_year_record(text, int) from public;
grant execute on function delete_fighter_year_record(text, int) to authenticated;

-- "Trending" = most active this calendar year, combining both signals
-- above -- greatest() rather than a sum, so a fighter who's logged both a
-- coarse year-count AND the individual bouts behind it isn't double
-- counted. security_invoker so this respects the real per-table SELECT
-- policies (same reasoning as fighter_directory, 0013), not the view
-- owner's broader access.
create or replace view trending_fighters
with (security_invoker = true) as
with appearance_counts as (
  select fighter_slug, count(*) as cnt
  from fighter_appearances
  where event_date >= date_trunc('year', now())::date and event_date < date_trunc('year', now())::date + interval '1 year'
  group by fighter_slug
),
year_record_counts as (
  select fighter_slug, fights as cnt
  from fighter_year_records
  where year = extract(year from now())::int
)
select
  f.slug, f.name, f.gym, f.weight_kg, f.sex,
  greatest(coalesce(ac.cnt, 0), coalesce(yr.cnt, 0))::int as fights_this_year
from fighters f
left join appearance_counts ac on ac.fighter_slug = f.slug
left join year_record_counts yr on yr.fighter_slug = f.slug
where greatest(coalesce(ac.cnt, 0), coalesce(yr.cnt, 0)) > 0;
