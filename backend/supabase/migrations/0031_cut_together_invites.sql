-- Weight Cut AI — "cut together": the bridge between the public fighter
-- directory (discovery) and Groups (shared progress tracking), which
-- until now were two disconnected systems -- Groups only ever formed
-- through a private invite code between people who already knew each
-- other, so finding a stranger cutting near your own weight and fight
-- date in the directory had no path into actually tracking that cut
-- together with them.
--
-- group_members' own INSERT policy (0002) is `with check (auth.uid() =
-- user_id)` -- a user can only ever add *themselves*, by design, so there
-- is no direct way for one user to add another to a group. That's the
-- right default (silently pulling a stranger's weight data into a shared
-- group without their consent would be a real privacy problem), which is
-- why this needs a real request/accept flow, not an instant add.

create table if not exists group_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  inviter_user_id uuid not null references auth.users(id) on delete cascade,
  invitee_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (group_id, invitee_user_id)
);

alter table group_invites enable row level security;

create policy "inviter or invitee can read the invite"
  on group_invites for select
  using (auth.uid() = invitee_user_id or auth.uid() = inviter_user_id);

-- No client INSERT/UPDATE policy at all -- both actions only ever happen
-- through the two RPCs below, which enforce who's allowed to invite whom
-- and who's allowed to respond.

create or replace function invite_to_cut_together(p_target_slug text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_user_id uuid;
  v_target_name text;
  v_group_id uuid;
  v_invite_id uuid;
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

  -- Already sharing a group (a previously accepted invite, or any other
  -- path into a shared group) -- nothing new to do.
  select gm1.group_id into v_group_id
  from group_members gm1
  join group_members gm2 on gm1.group_id = gm2.group_id
  where gm1.user_id = auth.uid() and gm2.user_id = v_target_user_id
  limit 1;

  if v_group_id is not null then
    raise exception 'You are already cutting together.';
  end if;

  -- Already invited and still pending -- don't spam a second group/invite.
  select id into v_invite_id
  from group_invites
  where inviter_user_id = auth.uid() and invitee_user_id = v_target_user_id and status = 'pending';

  if v_invite_id is not null then
    return v_invite_id;
  end if;

  v_invite_code := '';
  for i in 1..6 loop
    v_invite_code := v_invite_code || substr(v_alphabet, floor(random() * length(v_alphabet) + 1)::int, 1);
  end loop;

  insert into groups (name, invite_code, created_by)
  values (format('Cutting with %s', coalesce(v_target_name, 'a training partner')), v_invite_code, auth.uid())
  returning id into v_group_id;

  insert into group_members (group_id, user_id) values (v_group_id, auth.uid());

  insert into group_invites (group_id, inviter_user_id, invitee_user_id)
  values (v_group_id, auth.uid(), v_target_user_id)
  returning id into v_invite_id;

  return v_invite_id;
end;
$$;

revoke all on function invite_to_cut_together(text) from public;
grant execute on function invite_to_cut_together(text) to authenticated;

create or replace function respond_to_cut_together_invite(p_invite_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_invitee_user_id uuid;
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  select group_id, invitee_user_id, status into v_group_id, v_invitee_user_id, v_status
  from group_invites where id = p_invite_id;

  if v_invitee_user_id is null or v_invitee_user_id <> auth.uid() then
    raise exception 'Invite not found.';
  end if;
  if v_status <> 'pending' then
    return;
  end if;

  if p_accept then
    insert into group_members (group_id, user_id) values (v_group_id, auth.uid())
    on conflict do nothing;
    update group_invites set status = 'accepted', responded_at = now() where id = p_invite_id;
  else
    update group_invites set status = 'declined', responded_at = now() where id = p_invite_id;
  end if;
end;
$$;

revoke all on function respond_to_cut_together_invite(uuid, boolean) from public;
grant execute on function respond_to_cut_together_invite(uuid, boolean) to authenticated;
