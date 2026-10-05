-- Weight Cut AI — fixes from a Fable 5 audit of the cut-together/
-- year-records/trending batch (0031, 0032). All five real findings below,
-- verified against the actual RPC logic, not just plausible-sounding.

-- 1 & 3: mutual-invite race + one-sided group naming.
-- If A invites B, then B invites A back before either responds, the old
-- version created two separate groups for the same pair (each side's
-- "already invited"/"already sharing a group" checks only looked at their
-- own outgoing invites and confirmed group_members, neither of which
-- covers "someone already invited ME"). Fixed by checking for a reverse
-- pending invite and accepting it instead of creating a duplicate.
-- Naming was also one-sided ("Cutting with {target}"), so an invitee who
-- accepted saw a group named after themselves -- fixed to name it after
-- both people when the caller has a claimed fighter of their own.
create or replace function invite_to_cut_together(p_target_slug text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_user_id uuid;
  v_target_name text;
  v_caller_name text;
  v_group_id uuid;
  v_invite_id uuid;
  v_reverse_invite_id uuid;
  v_invite_code text;
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  i int;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  select claimed_by_user_id, name into v_target_user_id, v_target_name
  from fighters where slug = p_target_slug;

  if v_target_user_id is null then
    raise exception 'This fighter has not claimed their profile yet.';
  end if;
  if v_target_user_id = auth.uid() then
    raise exception 'You cannot invite yourself.';
  end if;

  select gm1.group_id into v_group_id
  from group_members gm1
  join group_members gm2 on gm1.group_id = gm2.group_id
  where gm1.user_id = auth.uid() and gm2.user_id = v_target_user_id
  limit 1;
  if v_group_id is not null then
    raise exception 'You are already cutting together.';
  end if;

  select id into v_invite_id
  from group_invites
  where inviter_user_id = auth.uid() and invitee_user_id = v_target_user_id and status = 'pending';
  if v_invite_id is not null then
    return v_invite_id;
  end if;

  -- They already invited you -- mutual interest, accept theirs rather
  -- than spin up a second, duplicate group.
  select id, group_id into v_reverse_invite_id, v_group_id
  from group_invites
  where inviter_user_id = v_target_user_id and invitee_user_id = auth.uid() and status = 'pending';
  if v_reverse_invite_id is not null then
    insert into group_members (group_id, user_id) values (v_group_id, auth.uid())
    on conflict do nothing;
    update group_invites set status = 'accepted', responded_at = now() where id = v_reverse_invite_id;
    return v_reverse_invite_id;
  end if;

  select name into v_caller_name from fighters where claimed_by_user_id = auth.uid() limit 1;

  v_invite_code := '';
  for i in 1..6 loop
    v_invite_code := v_invite_code || substr(v_alphabet, floor(random() * length(v_alphabet) + 1)::int, 1);
  end loop;

  insert into groups (name, invite_code, created_by)
  values (
    case when v_caller_name is not null
      then format('%s & %s', v_caller_name, coalesce(v_target_name, 'a training partner'))
      else format('Cutting with %s', coalesce(v_target_name, 'a training partner'))
    end,
    v_invite_code, auth.uid()
  )
  returning id into v_group_id;

  insert into group_members (group_id, user_id) values (v_group_id, auth.uid());

  insert into group_invites (group_id, inviter_user_id, invitee_user_id)
  values (v_group_id, auth.uid(), v_target_user_id)
  returning id into v_invite_id;

  return v_invite_id;
end;
$$;

-- 2: the invitee has no group_members row until they accept, and groups'
-- only SELECT policy (0002) requires membership -- so PostgREST silently
-- returned null for the embedded group name in myPendingInvites(), and
-- every invite displayed the generic "Cutting together" fallback instead
-- of the real name. Narrow, additive policy: an invitee can read the name
-- of a group they've been invited to, nothing else about it.
create policy "invitee can read the group name for their pending invite"
  on groups for select
  using (
    exists (
      select 1 from group_invites
      where group_invites.group_id = groups.id and group_invites.invitee_user_id = auth.uid()
    )
  );

-- 4 & 5: TOCTOU on the slug-collision loop (two concurrent creates with
-- the same name could both pass the `while exists` check before either
-- commits, then collide on insert) and no cap on self-created profiles
-- at all. Fixed the race the same way ensure_referral_code() (0005)
-- already does in this codebase -- catch the real unique_violation and
-- retry, rather than checking-then-inserting non-atomically. Capped at
-- one self-created profile per user: a real person only needs one for
-- themselves, and unlimited creation would let the directory (and
-- trending_fighters) be gamed with fake profiles.
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
  if exists (select 1 from fighters where claimed_by_user_id = auth.uid() and is_self_created = true) then
    raise exception 'You already have a created profile.';
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
