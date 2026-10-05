-- Weight Cut AI — push notification infrastructure: "your result just
-- posted" for a claimed fighter.
--
-- Two pieces: where a device's push token lives (profiles, same
-- no-client-UPDATE-policy posture as full_name/0026 -- writes only ever go
-- through a security-definer RPC), and a queue of notifications to send
-- (push_notification_outbox), populated by a trigger on fighter_appearances
-- rather than application code polling for changes.
--
-- The trigger fires only on a real pending -> decided transition
-- (old.result = 'pending', new.result in ('win','loss')), and only for
-- scraper-sourced rows (is_self_reported = false) -- a fighter typing
-- their own result doesn't need to be told their own result just posted.
-- It only queues a row; actually sending is a separate Edge Function
-- (send-push-notifications) so a slow/failed push API call never blocks
-- or fails the scraper's own upsert transaction.

alter table profiles add column if not exists expo_push_token text;
alter table profiles add column if not exists notify_on_result boolean not null default false;

create table if not exists push_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  body text not null,
  data jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists idx_push_outbox_unsent on push_notification_outbox(created_at) where sent_at is null;

-- No RLS SELECT/INSERT policy for regular users at all -- this table is
-- written only by the trigger below (runs as the table owner, not a
-- request-scoped role) and read only by the send-push-notifications Edge
-- Function via the service-role key, which bypasses RLS entirely. A
-- client has no legitimate reason to read or write anyone's outbox,
-- including their own.
alter table push_notification_outbox enable row level security;

create or replace function queue_result_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_fighter_name text;
begin
  if new.is_self_reported or old.result <> 'pending' or new.result not in ('win', 'loss') then
    return new;
  end if;

  select claimed_by_user_id, name into v_user_id, v_fighter_name
  from fighters
  where slug = new.fighter_slug;

  if v_user_id is null then
    return new;
  end if;

  insert into push_notification_outbox (user_id, title, body, data)
  values (
    v_user_id,
    'Your result is in',
    format('%s vs %s at %s: %s', v_fighter_name, new.opponent_name, new.event_name, upper(new.result)),
    jsonb_build_object('appearanceId', new.id, 'fighterSlug', new.fighter_slug)
  );

  return new;
end;
$$;

drop trigger if exists trg_queue_result_notification on fighter_appearances;
create trigger trg_queue_result_notification
  after update on fighter_appearances
  for each row
  execute function queue_result_notification();

create or replace function save_push_token(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  insert into profiles (id, expo_push_token, notify_on_result) values (auth.uid(), p_token, true)
  on conflict (id) do update set expo_push_token = excluded.expo_push_token, notify_on_result = true;
end;
$$;

revoke all on function save_push_token(text) from public;
grant execute on function save_push_token(text) to authenticated;

create or replace function disable_push_notifications()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  update profiles set notify_on_result = false, expo_push_token = null where id = auth.uid();
end;
$$;

revoke all on function disable_push_notifications() from public;
grant execute on function disable_push_notifications() to authenticated;
