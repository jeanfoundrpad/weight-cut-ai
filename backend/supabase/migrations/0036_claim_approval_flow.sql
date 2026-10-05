-- Weight Cut AI — every claim (existing profile or brand-new) now goes
-- through Jean for approval before it takes effect, per Jean directly:
-- "maybe everyone's submission should be sent to me for approval." This
-- replaces instant self-service claiming (0019/0032/0035) rather than
-- layering on top of it -- the previous safeguards (one identity per
-- account, no unique_violation race) still matter and are preserved
-- here, but the actual grant of claimed_by_user_id no longer happens at
-- request time at all.

alter table profiles add column if not exists is_admin boolean not null default false;

-- Jean's own account -- the only real signed-up user in this project so
-- far, and the one who needs to review requests. Upsert rather than a
-- plain update: a profiles row is only ever lazily created (see
-- ensure_referral_code/save_full_name), so one might not exist yet.
insert into profiles (id, is_admin) values ('2f92b2bc-7269-41e5-beff-5ce5243ba20f', true)
on conflict (id) do update set is_admin = true;

-- fighter_slug is null for a "create me a brand-new profile" request --
-- the fighters row itself isn't created until approval, so an unreviewed
-- request never pollutes the public directory even briefly.
create table if not exists fighter_claim_requests (
  id uuid primary key default gen_random_uuid(),
  requester_user_id uuid not null references auth.users(id) on delete cascade,
  fighter_slug text references fighters(slug) on delete cascade,
  requested_name text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null
);

create index if not exists idx_claim_requests_status on fighter_claim_requests(status);

alter table fighter_claim_requests enable row level security;

create policy "requester can read their own claim requests"
  on fighter_claim_requests for select
  using (auth.uid() = requester_user_id);

create policy "admins can read all claim requests"
  on fighter_claim_requests for select
  using (exists (select 1 from profiles where id = auth.uid() and is_admin = true));

create or replace function request_fighter_claim(p_slug text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  if exists (select 1 from fighters where claimed_by_user_id = auth.uid()) then
    raise exception 'You already have a claimed profile.';
  end if;
  if exists (select 1 from fighter_claim_requests where requester_user_id = auth.uid() and status = 'pending') then
    raise exception 'You already have a request pending review.';
  end if;
  if not exists (select 1 from fighters where slug = p_slug and claimed_by_user_id is null) then
    raise exception 'This fighter is not available to claim.';
  end if;
  if exists (select 1 from fighter_claim_requests where fighter_slug = p_slug and status = 'pending') then
    raise exception 'Someone has already requested this profile. Check back soon.';
  end if;

  insert into fighter_claim_requests (requester_user_id, fighter_slug)
  values (auth.uid(), p_slug)
  returning id into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function request_fighter_claim(text) from public;
grant execute on function request_fighter_claim(text) to authenticated;

create or replace function request_new_fighter_profile(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  if trim(coalesce(p_name, '')) = '' then
    raise exception 'Name is required.';
  end if;
  if exists (select 1 from fighters where claimed_by_user_id = auth.uid()) then
    raise exception 'You already have a claimed profile.';
  end if;
  if exists (select 1 from fighter_claim_requests where requester_user_id = auth.uid() and status = 'pending') then
    raise exception 'You already have a request pending review.';
  end if;

  insert into fighter_claim_requests (requester_user_id, requested_name)
  values (auth.uid(), trim(p_name))
  returning id into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function request_new_fighter_profile(text) from public;
grant execute on function request_new_fighter_profile(text) to authenticated;

create or replace function approve_claim_request(p_request_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requester uuid;
  v_slug text;
  v_requested_name text;
  v_status text;
  v_base_slug text;
  v_suffix int := 1;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Not authorized.';
  end if;

  select requester_user_id, fighter_slug, requested_name, status
  into v_requester, v_slug, v_requested_name, v_status
  from fighter_claim_requests where id = p_request_id;

  if v_requester is null then
    raise exception 'Request not found.';
  end if;
  if v_status <> 'pending' then
    raise exception 'This request was already reviewed.';
  end if;

  if v_slug is not null then
    update fighters set claimed_by_user_id = v_requester where slug = v_slug and claimed_by_user_id is null;
    if not found then
      raise exception 'That profile was claimed by someone else in the meantime.';
    end if;
  else
    v_base_slug := trim(both '-' from regexp_replace(lower(trim(v_requested_name)), '[^a-z0-9]+', '-', 'g'));
    if v_base_slug = '' then
      v_base_slug := 'fighter';
    end if;
    v_slug := v_base_slug;
    loop
      begin
        insert into fighters (slug, name, claimed_by_user_id, is_self_created, source_url)
        values (v_slug, v_requested_name, v_requester, true, null);
        exit;
      exception when unique_violation then
        v_suffix := v_suffix + 1;
        v_slug := v_base_slug || '-' || v_suffix;
      end;
    end loop;
  end if;

  update fighter_claim_requests
  set status = 'approved', reviewed_at = now(), reviewed_by = auth.uid(), fighter_slug = v_slug
  where id = p_request_id;

  return v_slug;
end;
$$;

revoke all on function approve_claim_request(uuid) from public;
grant execute on function approve_claim_request(uuid) to authenticated;

create or replace function reject_claim_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Not authorized.';
  end if;

  update fighter_claim_requests
  set status = 'rejected', reviewed_at = now(), reviewed_by = auth.uid()
  where id = p_request_id and status = 'pending';

  if not found then
    raise exception 'Request not found or already reviewed.';
  end if;
end;
$$;

revoke all on function reject_claim_request(uuid) from public;
grant execute on function reject_claim_request(uuid) to authenticated;

-- The old instant-claim path is fully disabled, not just unused --
-- leaving it merely uncalled by the client would still let anyone with
-- the anon key call it directly. unclaim_fighter stays enabled: giving up
-- a claim you already legitimately hold needs no review.
revoke execute on function claim_fighter(text) from authenticated;
revoke execute on function create_and_claim_fighter(text) from authenticated;
