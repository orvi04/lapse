create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  apns_token text not null,
  live_activity_token text,
  environment text not null check (environment in ('sandbox', 'production')),
  updated_at timestamptz not null default now(),
  unique (user_id, apns_token)
);
create index devices_user_idx on public.devices (user_id);

create table public.notification_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  friend_requests boolean not null default true,
  session_invites boolean not null default true,
  friend_posts boolean not null default true,
  reactions boolean not null default true,
  comments boolean not null default true,
  daily_reminder_time time,
  updated_at timestamptz not null default now()
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  target_type text not null check (target_type in ('profile', 'post', 'comment')),
  target_id uuid not null,
  reason text not null check (char_length(reason) between 1 and 500),
  created_at timestamptz not null default now()
);
create index reports_reporter_idx on public.reports (reporter_id);

alter table public.devices enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.reports enable row level security;

create policy devices_all on public.devices for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy prefs_select on public.notification_preferences for select to authenticated
  using (user_id = (select auth.uid()));
create policy prefs_update on public.notification_preferences for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy reports_insert on public.reports for insert to authenticated
  with check (reporter_id = (select auth.uid()));

revoke all on public.devices, public.notification_preferences, public.reports from anon;
revoke insert, delete on public.notification_preferences from authenticated;
revoke select, update, delete on public.reports from authenticated;

-- Sign-up: age check without storing the date of birth.
create function public.create_profile(p_username text, p_display_name text, p_timezone text, p_birth_date date)
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  result public.profiles;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_birth_date is null or p_birth_date > (current_date - interval '18 years')::date then
    raise exception 'You must be 18 or over to use Lapse';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'unknown timezone';
  end if;
  insert into public.profiles (id, username, display_name, timezone, adult_confirmed_at)
  values (uid, lower(trim(p_username)), trim(p_display_name), p_timezone, now())
  returning * into result;
  insert into public.notification_preferences (user_id) values (uid);
  return result;
end;
$$;

create function public.send_friend_request(p_username text)
returns public.friendships language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  target uuid;
  f public.friendships;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select id into target from public.profiles where username = lower(trim(p_username));
  if target is null or target = uid or public.is_blocked_between(uid, target) then
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

create function public.respond_friend_request(p_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  f public.friendships;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into f from public.friendships where id = p_id;
  if not found or f.status <> 'pending' or f.requested_by = uid or uid not in (f.user_low, f.user_high) then
    raise exception 'request not found';
  end if;
  if p_accept then
    update public.friendships set status = 'accepted', accepted_at = now() where id = p_id;
  else
    delete from public.friendships where id = p_id;
  end if;
end;
$$;

create function public.create_group_session(p_friend uuid, p_config jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  gid uuid;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not public.are_friends(uid, p_friend) then
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

create function public.respond_group_invite(p_group uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  update public.group_participants
  set state = case when p_accept then 'joined' else 'declined' end,
      joined_at = case when p_accept then now() else null end
  where group_id = p_group and user_id = uid and state = 'invited';
  if not found then raise exception 'invite not found'; end if;
  if not p_accept then
    update public.group_sessions set status = 'cancelled', ended_at = now()
    where id = p_group and status = 'lobby';
  end if;
end;
$$;

create function public.leave_group_session(p_group uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  update public.group_participants
  set state = 'left', left_at = now()
  where group_id = p_group and user_id = uid and state = 'joined';
  if not found then raise exception 'not in this session'; end if;
end;
$$;

create function public.activity_by_day(p_from date, p_to date)
returns table (local_date date, post_count bigint, focus_seconds bigint)
language sql stable security invoker set search_path = '' as $$
  select p.local_date, count(*), coalesce(sum(p.focus_seconds), 0)::bigint
  from public.posts p
  where p.author_id = (select auth.uid())
    and p.local_date between p_from and p_to
  group by p.local_date
  order by p.local_date;
$$;

create function public.expire_stale_presence()
returns void language sql security definer set search_path = '' as $$
  delete from public.live_presence where last_heartbeat_at < now() - interval '10 minutes';
$$;

revoke execute on function public.create_profile(text, text, text, date) from public, anon;
revoke execute on function public.send_friend_request(text) from public, anon;
revoke execute on function public.respond_friend_request(uuid, boolean) from public, anon;
revoke execute on function public.create_group_session(uuid, jsonb) from public, anon;
revoke execute on function public.respond_group_invite(uuid, boolean) from public, anon;
revoke execute on function public.leave_group_session(uuid) from public, anon;
revoke execute on function public.activity_by_day(date, date) from public, anon;
revoke execute on function public.expire_stale_presence() from public, anon, authenticated;
grant execute on function public.create_profile(text, text, text, date) to authenticated;
grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;
grant execute on function public.create_group_session(uuid, jsonb) to authenticated;
grant execute on function public.respond_group_invite(uuid, boolean) to authenticated;
grant execute on function public.leave_group_session(uuid) to authenticated;
grant execute on function public.activity_by_day(date, date) to authenticated;
