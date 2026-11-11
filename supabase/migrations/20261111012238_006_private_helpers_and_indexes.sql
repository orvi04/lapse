create schema if not exists private;
grant usage on schema private to authenticated;

alter function public.is_blocked_between(uuid, uuid) set schema private;
alter function public.are_friends(uuid, uuid) set schema private;
alter function public.is_group_member(uuid) set schema private;
alter function public.can_read_media_path(text) set schema private;
alter function public.can_read_snapshot_path(text) set schema private;

create or replace function private.are_friends(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select a is not null and b is not null
    and exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and f.user_low = least(a, b) and f.user_high = greatest(a, b)
    )
    and not private.is_blocked_between(a, b);
$$;

create or replace function private.can_read_media_path(p_path text)
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
      and private.are_friends(p.author_id, auth.uid())
      and (
        p.feed_expires_at > now()
        or exists (select 1 from public.post_pins pn where pn.post_id = p.id)
      )
  );
$$;

create or replace function private.can_read_snapshot_path(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.break_snapshots s
    where s.storage_path = p_path
      and private.is_group_member(s.group_id)
  );
$$;

create or replace function public.send_friend_request(p_username text)
returns public.friendships language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  target uuid;
  f public.friendships;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select id into target from public.profiles where username = lower(trim(p_username));
  if target is null or target = uid or private.is_blocked_between(uid, target) then
    raise exception 'user not found';
  end if;
  select * into f from public.friendships
  where user_low = least(uid, target) and user_high = greatest(uid, target);
  if found then
    if f.status = 'pending' and f.requested_by <> uid then
      update public.friendships set status = 'accepted', accepted_at = now()
      where id = f.id returning * into f;
    end if;
    return f;
  end if;
  insert into public.friendships (user_low, user_high, requested_by)
  values (least(uid, target), greatest(uid, target), uid)
  returning * into f;
  return f;
end;
$$;

create or replace function public.create_group_session(p_friend uuid, p_config jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  gid uuid;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not private.are_friends(uid, p_friend) then
    raise exception 'you can only start a Co-op session with a friend';
  end if;
  insert into public.group_sessions (host_id, config) values (uid, coalesce(p_config, '{}'::jsonb))
  returning id into gid;
  update public.group_sessions set livekit_room = 'lapse-' || gid::text where id = gid;
  insert into public.group_participants (group_id, user_id, state, joined_at) values (gid, uid, 'joined', now());
  insert into public.group_participants (group_id, user_id, state) values (gid, p_friend, 'invited');
  return gid;
end;
$$;

create index friendships_requested_by_idx on public.friendships (requested_by);
create index group_sessions_host_idx on public.group_sessions (host_id);
create index group_phases_initiated_by_idx on public.group_phases (initiated_by);
create index break_snapshots_taken_by_idx on public.break_snapshots (taken_by);
