-- Weight Cut AI — a real name for the account, not just email/password.
--
-- The app never collected one until now (see the "eventually do the math"
-- conversation with Jean) -- account creation is email/password only, and
-- the fighter-claim screen's "search your name" box was only ever used as
-- a throwaway search query, discarded whether or not a match was claimed.
-- Jean's correction: claiming should only ever be reachable from that
-- onboarding name-entry moment, which means what's typed there needs to
-- actually persist as the account's name either way, not just double as
-- search input. Follows the same lazy-upsert pattern as
-- ensure_referral_code() (0005) -- profiles rows are never created at
-- signup time, only the first time some RPC actually needs one.

alter table profiles add column if not exists full_name text;

create or replace function save_full_name(p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  insert into profiles (id, full_name) values (auth.uid(), nullif(trim(p_name), ''))
  on conflict (id) do update set full_name = nullif(trim(excluded.full_name), '');
end;
$$;

revoke all on function save_full_name(text) from public;
grant execute on function save_full_name(text) to authenticated;
