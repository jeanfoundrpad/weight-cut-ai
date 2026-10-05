-- Weight Cut AI — fixes a real, live bug found by an independent code
-- review and confirmed against the actual database:
-- `select * from group_members` as an authenticated user raises
-- Postgres 42P17 "infinite recursion detected in policy for relation
-- group_members". 0002's own SELECT policy on group_members subqueries
-- group_members from within a policy on group_members -- a direct self
-- reference, which Postgres rejects outright rather than looping.
--
-- 0007 already fixed this table's INSERT policy for a different reason
-- and left a comment explaining RLS-inside-RLS gotchas on this exact
-- table, but never touched the SELECT policy, which had the same class
-- of problem in a different shape.
--
-- groupMemberProgress()/myGroups() (lib/groupsClient.ts) both discard
-- their error object (`if (error || !data) return []`), so this has been
-- indistinguishable from "no groups yet" -- the Groups tab and the coach
-- dashboard have been silently empty for every real member this whole
-- time, not just newly-joined ones.
--
-- Fixed with a security-definer helper: it runs as the table owner, so
-- its own internal select against group_members does not re-trigger
-- group_members' RLS, breaking the cycle. groups' and progress_snapshots'
-- policies already subquery group_members from a DIFFERENT table's
-- policy (not self-referencing), so they were only ever broken
-- transitively by this one bad policy -- fixing this one is sufficient,
-- confirmed live below.
create or replace function is_group_member(p_group_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from group_members
    where group_members.group_id = p_group_id and group_members.user_id = auth.uid()
  );
$$;

revoke all on function is_group_member(uuid) from public;
grant execute on function is_group_member(uuid) to authenticated;

drop policy if exists "members can see who else is in their groups" on group_members;
create policy "members can see who else is in their groups"
  on group_members for select
  using (is_group_member(group_members.group_id));
