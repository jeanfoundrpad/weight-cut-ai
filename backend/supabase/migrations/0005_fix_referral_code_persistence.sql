-- Weight Cut AI — fix referral codes regenerating on every call.
--
-- ensure_referral_code() assumed a `profiles` row already existed for the
-- calling user (profiles.id references auth.users, RLS lets a user insert
-- their own row, but nothing in the app ever actually did that insert —
-- there's no signup-time profiles row creation anywhere in the client).
-- With no row to find, `select referral_code into v_existing from profiles
-- where id = auth.uid()` always came back null, so the function always
-- fell through to generating a fresh code — and the `update profiles set
-- referral_code = v_code where id = auth.uid()` that was supposed to save
-- it silently affected zero rows (UPDATE on no matching row is not an
-- error in Postgres), so nothing ever actually persisted. Every call to
-- the Profile screen generated and displayed a brand new, never-saved code.
--
-- Fixed by upserting the profiles row itself before doing anything else,
-- so there's always a real row to read from and write to.

create or replace function ensure_referral_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_existing text;
  i int;
begin
  if auth.uid() is null then
    return null;
  end if;

  insert into profiles (id) values (auth.uid())
  on conflict (id) do nothing;

  select referral_code into v_existing from profiles where id = auth.uid();
  if v_existing is not null then
    return v_existing;
  end if;
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, floor(random() * length(v_alphabet) + 1)::int, 1);
    end loop;
    begin
      update profiles set referral_code = v_code where id = auth.uid();
      return v_code;
    exception when unique_violation then
      -- Collision on v_code itself — loop and generate another one.
    end;
  end loop;
end;
$$;

revoke all on function ensure_referral_code() from public;
grant execute on function ensure_referral_code() to authenticated;
