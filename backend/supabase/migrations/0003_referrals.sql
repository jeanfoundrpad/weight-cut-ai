-- Weight Cut AI — referral attribution scaffolding.
--
-- Tracks who invited whom, nothing more. No payout/credit/currency field on
-- purpose: incentive payout logic depends on live payment infrastructure
-- (RevenueCat), which is still paused. Building the payout side now would
-- mean guessing at numbers instead of wiring it to real subscription events
-- later — this just makes sure the attribution data exists from day one so
-- a payout feature can be added later without a backfill problem.

alter table profiles add column if not exists referral_code text unique;

create table if not exists referrals (
  id bigint generated always as identity primary key,
  referrer_id uuid not null references auth.users(id) on delete cascade,
  referred_id uuid not null references auth.users(id) on delete cascade unique,
  created_at timestamptz not null default now(),
  check (referrer_id <> referred_id)
);

alter table referrals enable row level security;

create policy "users read referrals they made"
  on referrals for select
  using (auth.uid() = referrer_id);

-- Attribution must be tamper-proof from the client (otherwise a user could
-- insert fake referred_id rows for accounts that never actually used their
-- code), so the insert happens through a security-definer function instead
-- of a direct table grant — same pattern as join_group_by_code in
-- 0002_groups.sql.
--
-- Returns whether it actually inserted a row, not void. If a project has
-- "confirm email" enabled, auth.uid() is still null right after signUp()
-- until the confirmation link is clicked, so this can legitimately no-op
-- on the very first call. Returning a real boolean lets the client tell
-- "attributed" apart from "silently did nothing" and retry later instead
-- of permanently discarding the referral code either way.
create or replace function claim_referral(p_referrer_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referrer_id uuid;
  v_row_count int;
begin
  if auth.uid() is null then
    return false;
  end if;
  select id into v_referrer_id from profiles where referral_code = upper(p_referrer_code);
  if v_referrer_id is null or v_referrer_id = auth.uid() then
    return false;
  end if;
  insert into referrals (referrer_id, referred_id)
  values (v_referrer_id, auth.uid())
  on conflict (referred_id) do nothing;
  get diagnostics v_row_count = row_count;
  return v_row_count > 0;
end;
$$;

revoke all on function claim_referral(text) from public;
grant execute on function claim_referral(text) to authenticated;

-- Lazily generates and stores a referral code for the calling user's own
-- profile row. Idempotent — returns the existing code if one is already
-- set, so it's safe to call every time the Profile screen wants to show it.
create or replace function ensure_referral_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_existing text;
  i int;
begin
  if auth.uid() is null then
    return null;
  end if;
  select referral_code into v_existing from profiles where id = auth.uid();
  if v_existing is not null then
    return v_existing;
  end if;
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, floor(random() * length(v_alphabet) + 1)::int, 1);
    end loop;
    begin
      update profiles set referral_code = v_code where id = auth.uid();
      return v_code;
    exception when unique_violation then
      -- Collision on v_code itself — loop and generate another one.
    end;
  end loop;
end;
$$;

revoke all on function ensure_referral_code() from public;
grant execute on function ensure_referral_code() to authenticated;
