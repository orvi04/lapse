-- New tables in public are not open to anonymous users by default.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null check (char_length(display_name) between 1 and 40),
  avatar_path text,
  timezone text not null default 'Europe/London',
  adult_confirmed_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  user_low uuid not null references public.profiles (id) on delete cascade,
  user_high uuid not null references public.profiles (id) on delete cascade,
  requested_by uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  constraint friendships_ordered check (user_low < user_high),
  constraint friendships_requester check (requested_by in (user_low, user_high)),
  constraint friendships_unique unique (user_low, user_high)
);
create index friendships_high_idx on public.friendships (user_high);

create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index blocks_blocked_idx on public.blocks (blocked_id);

alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.blocks enable row level security;

create function public.is_blocked_between(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  );
$$;

create function public.are_friends(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select a is not null and b is not null
    and exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and f.user_low = least(a, b) and f.user_high = greatest(a, b)
    )
    and not public.is_blocked_between(a, b);
$$;

revoke execute on function public.is_blocked_between(uuid, uuid) from public, anon;
revoke execute on function public.are_friends(uuid, uuid) from public, anon;
grant execute on function public.is_blocked_between(uuid, uuid) to authenticated;
grant execute on function public.are_friends(uuid, uuid) to authenticated;

create policy profiles_select on public.profiles for select to authenticated
  using (not public.is_blocked_between(id, (select auth.uid())));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy friendships_select on public.friendships for select to authenticated
  using ((select auth.uid()) in (user_low, user_high));
create policy friendships_delete on public.friendships for delete to authenticated
  using ((select auth.uid()) in (user_low, user_high));

create policy blocks_select on public.blocks for select to authenticated
  using (blocker_id = (select auth.uid()));
create policy blocks_insert on public.blocks for insert to authenticated
  with check (blocker_id = (select auth.uid()));
create policy blocks_delete on public.blocks for delete to authenticated
  using (blocker_id = (select auth.uid()));

revoke all on public.profiles, public.friendships, public.blocks from anon;
revoke insert, update, delete on public.profiles from authenticated;
grant update (username, display_name, avatar_path, timezone) on public.profiles to authenticated;
revoke insert, update on public.friendships from authenticated;

create function public.handle_block()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.friendships
  where user_low = least(new.blocker_id, new.blocked_id)
    and user_high = greatest(new.blocker_id, new.blocked_id);
  return new;
end;
$$;
revoke execute on function public.handle_block() from public, anon, authenticated;
create trigger on_block_created after insert on public.blocks
  for each row execute function public.handle_block();
