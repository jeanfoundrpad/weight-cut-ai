-- Weight Cut AI — group messaging + opt-in meal recommendations.
--
-- Real user-generated content, unlike everything else in the groups
-- feature so far — 0002_groups.sql's own header explicitly says groups
-- were designed to avoid UGC entirely ("not food logs, not a content
-- feed") specifically to stay out of App Store Guideline 1.2's
-- moderation requirements. Jean asked directly for coach<->fighter and
-- fighter<->fighter communication, which genuinely needs real messaging,
-- so this reopens that tradeoff deliberately, not by accident — and
-- ships with the two things Guideline 1.2 actually requires for any UGC
-- feature: a way to report content and a way to block a user, not just
-- the messaging itself.
--
-- Opt-in meal recommendations reuse this same table (kind = 'meal_share')
-- rather than a parallel system, so report/block cover both message
-- types with one mechanism. This is NOT an automatic feed of what
-- someone ate — see groupsClient.ts's shareMealToGroup(): a member has
-- to deliberately choose one specific meal to post. An automatic
-- "everyone's food diary is visible" feed was considered and rejected —
-- social comparison specifically around food is a documented eating
-- disorder risk factor, and this app's audience (combat athletes
-- actively cutting weight) is already a higher-risk population for it.

create table if not exists group_messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  -- Captured from the sender's own device at send time rather than joined
  -- from a shared profiles table — profiles.select is scoped to "own row
  -- only" (0001_init.sql) and this avoids widening that just to label chat
  -- messages, the same reasoning groupMemberProgress() already used to
  -- justify leaving member email null instead of exposing auth.users.
  sender_label text not null default 'Fighter',
  kind text not null default 'text' check (kind in ('text', 'meal_share')),
  body text,
  meal_label text,
  meal_kcal real,
  meal_protein_g real,
  meal_carbs_g real,
  meal_fat_g real,
  created_at timestamptz not null default now()
);
create index if not exists idx_group_messages_group on group_messages(group_id, created_at);

alter table group_messages enable row level security;

create policy "group members can read messages in their groups"
  on group_messages for select
  using (
    exists (
      select 1 from group_members
      where group_members.group_id = group_messages.group_id and group_members.user_id = auth.uid()
    )
  );

create policy "group members can post messages in their groups"
  on group_messages for insert
  with check (
    auth.uid() = sender_id
    and exists (
      select 1 from group_members
      where group_members.group_id = group_messages.group_id and group_members.user_id = auth.uid()
    )
  );

create policy "senders can delete their own messages"
  on group_messages for delete
  using (auth.uid() = sender_id);

-- Lets a user block another user unilaterally, no cooperation or admin
-- needed — blocked senders' messages are filtered client-side (see
-- groupsClient.ts's groupMessages()), a deliberately simple mechanism
-- matched to this app's actual scale, not a full trust-and-safety system.
create table if not exists blocked_users (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

alter table blocked_users enable row level security;

create policy "users can manage their own block list"
  on blocked_users for all
  using (auth.uid() = blocker_id)
  with check (auth.uid() = blocker_id);

-- No client-facing select policy at all, on purpose — reports are reviewed
-- manually via the Supabase dashboard's service-role access for now,
-- appropriate for this app's current scale. A real moderation queue is
-- future work, not required to satisfy Guideline 1.2 at this size, and
-- Jean's contact email is already published on the support page for
-- anyone reporting something outside the app.
create table if not exists message_reports (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references group_messages(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now()
);

alter table message_reports enable row level security;

create policy "users can file reports"
  on message_reports for insert
  with check (auth.uid() = reporter_id);
