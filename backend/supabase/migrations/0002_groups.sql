-- Weight Cut AI — private accountability groups.
--
-- Deliberately NOT a public/discoverable feature: groups are invite-only
-- (join by code or link, never browsable), and the only data shared between
-- members is a single current-progress snapshot per person — not food logs,
-- not a content feed. This keeps the app out of App Store Guideline 1.2's
-- user-generated-content moderation requirements (no posts, no comments,
-- nothing for one member to post that harms another) while still giving
-- real accountability value. See the conversation this was scoped from for
-- the fuller reasoning — a public feed was explicitly considered and
-- rejected for this product.

create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Created before any policy on `groups` runs, since the groups SELECT
-- policy below references this table — declaring it after that policy
-- (as an earlier draft of this file did) fails with "relation
-- group_members does not exist" the first time this migration is ever
-- actually applied to a real Postgres database.
create table if not exists group_members (
  group_id uuid not null references groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

alter table groups enable row level security;

create policy "members can read their own groups"
  on groups for select
  using (
    exists (
      select 1 from group_members
      where group_members.group_id = groups.id and group_members.user_id = auth.uid()
    )
  );

create policy "any signed-in user can create a group"
  on groups for insert
  with check (auth.uid() = created_by);

alter table group_members enable row level security;

create policy "members can see who else is in their groups"
  on group_members for select
  using (
    exists (
      select 1 from group_members as my_membership
      where my_membership.group_id = group_members.group_id and my_membership.user_id = auth.uid()
    )
  );

create policy "users can add themselves to a group they're joining"
  on group_members for insert
  with check (auth.uid() = user_id);

-- One row per user — the LATEST snapshot only, not a history. Accountability
-- needs "where are they right now," not a log another member could pore
-- over. Weight/target numbers, not food or photos.
create table if not exists progress_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  current_weight_kg real,
  weigh_in_target_kg real,
  weigh_in_date timestamptz,
  updated_at timestamptz not null default now()
);

alter table progress_snapshots enable row level security;

create policy "users can write their own snapshot"
  on progress_snapshots for insert
  with check (auth.uid() = user_id);

create policy "users can update their own snapshot"
  on progress_snapshots for update
  using (auth.uid() = user_id);

create policy "group members can read each other's snapshots"
  on progress_snapshots for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from group_members as mine
      join group_members as theirs on theirs.group_id = mine.group_id
      where mine.user_id = auth.uid() and theirs.user_id = progress_snapshots.user_id
    )
  );

-- Joining by code is a chicken-and-egg problem under the "groups" SELECT
-- policy above: it requires existing membership to read a group row, but
-- a user trying to join is by definition not yet a member, so a plain
-- client-side select-by-invite-code always returns zero rows. This
-- function is the narrow, deliberate RLS bypass that makes "joinable by
-- exact code, not otherwise browsable" actually work: it looks up a group
-- by code and inserts the caller's membership in one atomic step, without
-- ever exposing the ability to list or search groups.
create or replace function join_group_by_code(p_code text)
returns table (id uuid, name text, invite_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
begin
  if auth.uid() is null then
    return;
  end if;

  select groups.id into v_group_id
  from groups
  where groups.invite_code = upper(p_code);

  if v_group_id is null then
    return;
  end if;

  insert into group_members (group_id, user_id)
  values (v_group_id, auth.uid())
  on conflict (group_id, user_id) do nothing;

  return query
  select groups.id, groups.name, groups.invite_code
  from groups
  where groups.id = v_group_id;
end;
$$;

revoke all on function join_group_by_code(text) from public;
grant execute on function join_group_by_code(text) to authenticated;
