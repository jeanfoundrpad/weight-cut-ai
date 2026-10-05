-- Weight Cut AI — closes a real impersonation hole found by an
-- independent code review, confirmed against the actual code: sendGroupMessage
-- and shareMealToGroup (lib/groupsClient.ts) both stamp `sender_label`
-- from myDisplayName(), which reads a purely local SQLite setting with
-- zero server-side validation. 0010's own INSERT policy only ever
-- checked `auth.uid() = sender_id` -- it never constrained the label at
-- all, so any member (or a tampered client) could post as "Coach Mike"
-- in a group where the real Coach Mike is also a member. In a community
-- built around real, named, publicly claimed fighters, that's a trust
-- problem, not a cosmetic one.
--
-- 0010's own comment explains why sender_label was captured client-side
-- in the first place: profiles' SELECT policy only ever allowed reading
-- your own row, so a member couldn't look up another member's name to
-- label a message correctly even if the client were trusted. Routing
-- sends through a security-definer RPC sidesteps that entirely -- it
-- reads the CALLER's own profiles.full_name (already always readable),
-- never anyone else's, and profiles' SELECT policy doesn't need widening
-- at all.
--
-- The direct-insert policy is dropped, not just superseded -- leaving it
-- in place would still let a tampered client bypass this RPC entirely
-- and insert with any label it wants, exactly the original hole.
drop policy if exists "group members can post messages in their groups" on group_messages;

create or replace function send_group_message(
  p_group_id uuid,
  p_kind text,
  p_body text default null,
  p_meal_label text default null,
  p_meal_kcal real default null,
  p_meal_protein_g real default null,
  p_meal_carbs_g real default null,
  p_meal_fat_g real default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_label text;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  if not is_group_member(p_group_id) then
    raise exception 'You are not a member of this group.';
  end if;
  if p_kind not in ('text', 'meal_share') then
    raise exception 'Invalid message kind.';
  end if;

  select full_name into v_label from profiles where id = auth.uid();
  v_label := coalesce(nullif(trim(v_label), ''), 'Fighter');

  insert into group_messages (
    group_id, sender_id, sender_label, kind, body,
    meal_label, meal_kcal, meal_protein_g, meal_carbs_g, meal_fat_g
  ) values (
    p_group_id, auth.uid(), v_label, p_kind, p_body,
    p_meal_label, p_meal_kcal, p_meal_protein_g, p_meal_carbs_g, p_meal_fat_g
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function send_group_message(uuid, text, text, text, real, real, real, real) from public;
grant execute on function send_group_message(uuid, text, text, text, real, real, real, real) to authenticated;
