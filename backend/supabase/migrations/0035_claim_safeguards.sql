-- Weight Cut AI — real safeguards against claiming someone else's
-- identity, per Jean directly, having just hit this himself: "I just
-- tried to pick Romani Alicea. My name is Jean in the app, I'm obviously
-- not Romani. Some people will pick other people's names. That will
-- obviously create problems."
--
-- claim_fighter (0019) only ever checked that the TARGET row was
-- unclaimed -- nothing stopped a signed-in user from claiming any name in
-- the directory regardless of whether it's actually them, and nothing
-- stopped the same account from claiming several different real people's
-- identities one after another. Two real gaps, both closed here:

-- 1. One real identity per account. A person is one person -- claiming an
-- existing scraped profile and creating a new one (0032) are two paths to
-- the same thing (linking a fighter identity to this account), so both
-- need the same cap, not just create_and_claim_fighter's existing
-- is_self_created-only check.
create or replace function claim_fighter(p_slug text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from fighters where claimed_by_user_id = auth.uid()) then
    raise exception 'You already have a claimed profile. Unclaim it first if this was a mistake.';
  end if;

  update fighters
  set claimed_by_user_id = auth.uid()
  where slug = p_slug and claimed_by_user_id is null;

  if not found then
    raise exception 'This fighter has already been claimed, or does not exist.';
  end if;
end;
$$;

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
  if exists (select 1 from fighters where claimed_by_user_id = auth.uid()) then
    raise exception 'You already have a claimed profile. Unclaim it first if this was a mistake.';
  end if;

  v_base_slug := trim(both '-' from regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '-', 'g'));
  if v_base_slug = '' then
    v_base_slug := 'fighter';
  end if;
  v_slug := v_base_slug;

  loop
    begin
      insert into fighters (slug, name, claimed_by_user_id, is_self_created, source_url)
      values (v_slug, trim(p_name), auth.uid(), true, null);
      return v_slug;
    exception when unique_violation then
      v_suffix := v_suffix + 1;
      v_slug := v_base_slug || '-' || v_suffix;
    end;
  end loop;
end;
$$;

-- 2. A way to flag a wrong claim at all. There's no admin/moderation
-- surface in this app yet, so this deliberately doesn't auto-unclaim
-- anything -- that would just trade one abuse vector (claiming someone
-- else) for another (falsely reporting a real claim to knock it loose).
-- It logs a reviewable report; unclaiming a disputed profile stays a
-- manual, reviewed action (direct query) until real moderation tooling
-- exists.
create table if not exists fighter_claim_reports (
  id uuid primary key default gen_random_uuid(),
  fighter_slug text not null references fighters(slug) on delete cascade,
  reporter_user_id uuid references auth.users(id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);

alter table fighter_claim_reports enable row level security;

-- No client SELECT/UPDATE/DELETE policy -- reports are write-only from
-- the client's side (same posture as message_reports elsewhere in this
-- schema), reviewed directly via the service role, not surfaced back to
-- any user including the reporter.

create or replace function report_fighter_claim(p_slug text, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  if not exists (select 1 from fighters where slug = p_slug and claimed_by_user_id is not null) then
    raise exception 'This profile is not currently claimed.';
  end if;

  insert into fighter_claim_reports (fighter_slug, reporter_user_id, reason)
  values (p_slug, auth.uid(), nullif(trim(coalesce(p_reason, '')), ''));
end;
$$;

revoke all on function report_fighter_claim(text, text) from public;
grant execute on function report_fighter_claim(text, text) to authenticated;
