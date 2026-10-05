-- Weight Cut AI — let a claimed fighter opt their real tracked weight into
-- their public fighter-directory profile.
--
-- progress_snapshots (0002) already exists for exactly this shape of data
-- (current_weight_kg, weigh_in_target_kg, weigh_in_date, synced from the
-- device via syncProgressSnapshot()) but is currently only readable by the
-- row's owner or a co-member of a shared group -- never the general
-- fighter directory, which anyone signed in can browse. That's the right
-- default (weigh-in history is sensitive), so making any of it public has
-- to be an explicit, off-by-default choice, not an automatic consequence
-- of claiming a profile.
--
-- share_publicly defaults false. The new SELECT policy is additive (an
-- extra permissive policy, OR'd with the existing ones by Postgres RLS),
-- so it only ever *adds* one more way a row can become visible -- it can
-- never narrow the group-sharing behavior that already existed.

alter table progress_snapshots add column if not exists share_publicly boolean not null default false;

create policy "anyone signed in can read a publicly-shared snapshot"
  on progress_snapshots for select
  using (share_publicly = true);
