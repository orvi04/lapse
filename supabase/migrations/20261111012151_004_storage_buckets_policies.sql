insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('timelapses', 'timelapses', false, 41943040, array['video/mp4', 'video/quicktime']),
  ('thumbnails', 'thumbnails', false, 2097152, array['image/jpeg', 'image/webp']),
  ('snapshots', 'snapshots', false, 5242880, array['image/jpeg', 'image/webp']),
  ('avatars', 'avatars', false, 2097152, array['image/jpeg', 'image/webp', 'image/png'])
on conflict (id) do nothing;

-- A file is readable if its owner asks, or a friend can currently see a post that uses it.
create function public.can_read_media_path(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.media m
    where (m.storage_path = p_path or m.thumb_path = p_path)
      and m.owner_id = auth.uid()
  )
  or exists (
    select 1
    from public.media m
    join public.posts p on p.media_id = m.id
    where (m.storage_path = p_path or m.thumb_path = p_path)
      and public.are_friends(p.author_id, auth.uid())
      and (
        p.feed_expires_at > now()
        or exists (select 1 from public.post_pins pn where pn.post_id = p.id)
      )
  );
$$;

create function public.can_read_snapshot_path(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.break_snapshots s
    where s.storage_path = p_path
      and (public.is_group_member(s.group_id))
  );
$$;

revoke execute on function public.can_read_media_path(text) from public, anon;
revoke execute on function public.can_read_snapshot_path(text) from public, anon;
grant execute on function public.can_read_media_path(text) to authenticated;
grant execute on function public.can_read_snapshot_path(text) to authenticated;

-- Uploads: only into your own folder (first path segment is your user id).
create policy "own folder insert" on storage.objects for insert to authenticated
  with check (
    bucket_id in ('timelapses', 'thumbnails', 'snapshots', 'avatars')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "own folder update" on storage.objects for update to authenticated
  using (
    bucket_id in ('timelapses', 'thumbnails', 'snapshots', 'avatars')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "own folder delete" on storage.objects for delete to authenticated
  using (
    bucket_id in ('timelapses', 'thumbnails', 'snapshots', 'avatars')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "read timelapses and thumbnails" on storage.objects for select to authenticated
  using (
    bucket_id in ('timelapses', 'thumbnails')
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or public.can_read_media_path(name)
    )
  );
create policy "read snapshots" on storage.objects for select to authenticated
  using (
    bucket_id = 'snapshots'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or public.can_read_snapshot_path(name)
    )
  );
create policy "read avatars" on storage.objects for select to authenticated
  using (bucket_id = 'avatars');
