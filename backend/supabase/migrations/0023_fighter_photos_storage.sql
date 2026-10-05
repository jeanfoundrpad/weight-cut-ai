-- Weight Cut AI — Storage bucket for fighter profile photos.
--
-- First real Supabase Storage usage in this app -- meal photos stay local
-- only (photo_uri in the on-device SQLite meals table, never uploaded),
-- so this is new infrastructure, not reusing an existing pattern.
--
-- Public read (photos are meant to be seen by anyone browsing the
-- directory, same posture as the rest of `fighters`). Write access scoped
-- to a folder-per-user path (`{auth.uid()}/...`), the standard idiomatic
-- Supabase Storage RLS pattern -- this only controls who can write to
-- *some* path in the bucket, not which fighter profile that path is
-- attached to. That second check (does this uploader actually own the
-- claimed fighter they're setting a photo for) happens separately in the
-- update_fighter_photo() RPC (0021), which is the only way a photo URL
-- actually gets attached to a fighters row.

insert into storage.buckets (id, name, public)
values ('fighter-photos', 'fighter-photos', true)
on conflict (id) do nothing;

create policy "anyone can view fighter photos"
  on storage.objects for select
  using (bucket_id = 'fighter-photos');

create policy "users can upload to their own folder"
  on storage.objects for insert
  with check (bucket_id = 'fighter-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "users can replace photos in their own folder"
  on storage.objects for update
  using (bucket_id = 'fighter-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "users can delete photos in their own folder"
  on storage.objects for delete
  using (bucket_id = 'fighter-photos' and (storage.foldername(name))[1] = auth.uid()::text);
