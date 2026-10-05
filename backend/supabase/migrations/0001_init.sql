-- Weight Cut AI — initial schema.
--
-- Two things worth explaining:
--
-- 1. trial_started_at lives on `profiles`, set once at account creation,
--    not just in the app's local settings table. A purely local trial
--    timer can be reset by deleting and reinstalling the app; recording it
--    server-side, tied to the account, closes that off.
--
-- 2. `subscription_status` is written ONLY by the revenuecat-webhook Edge
--    Function (via the service-role key, which bypasses RLS). Regular
--    users get read-only access to their own row and no direct
--    INSERT/UPDATE/DELETE grant at all — entitlement state must only ever
--    change because RevenueCat said so, never because a client called an
--    API directly.

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  trial_started_at timestamptz,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "users read own profile"
  on profiles for select
  using (auth.uid() = id);

create policy "users insert own profile once"
  on profiles for insert
  with check (auth.uid() = id);

create table if not exists subscription_status (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'none' check (status in ('none', 'trial', 'active', 'canceled', 'expired', 'billing_issue')),
  product_id text,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table subscription_status enable row level security;

create policy "users read own subscription status"
  on subscription_status for select
  using (auth.uid() = user_id);

-- Deliberately no insert/update/delete policy for regular users — only the
-- service role (used exclusively by the webhook function) can write here.

create table if not exists scan_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  cost_usd numeric(10, 6) not null default 0,
  created_at timestamptz not null default now()
);

alter table scan_usage enable row level security;

create policy "users read own usage"
  on scan_usage for select
  using (auth.uid() = user_id);

-- Without this, analyze-photo's own usage-logging insert (run as the
-- caller, not service role) is silently blocked by RLS, which also means
-- the daily scan cap can never see any rows to count.
create policy "users insert own usage"
  on scan_usage for insert
  with check (auth.uid() = user_id);

create index if not exists idx_scan_usage_user_date on scan_usage(user_id, created_at);
