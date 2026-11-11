-- Promise lists: a flexible group of promises with an optional caption, shown to friends like a post.
create table public.promise_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  caption text check (char_length(caption) <= 280),
  local_date date not null,
  created_at timestamptz not null default now(),
  feed_expires_at timestamptz not null default (now() + interval '24 hours'),
  archived_at timestamptz
);
create index promise_lists_user_idx on public.promise_lists (user_id, created_at desc);
create index promise_lists_feed_idx on public.promise_lists (feed_expires_at desc);
alter table public.promise_lists enable row level security;

alter table public.promises add column list_id uuid references public.promise_lists (id) on delete cascade;
create index promises_list_idx on public.promises (list_id);

-- Move existing promises into one list per user per day.
insert into public.promise_lists (user_id, local_date, created_at, feed_expires_at)
select user_id, local_date, min(created_at), min(created_at) + interval '24 hours'
from public.promises group by user_id, local_date;
update public.promises p set list_id = l.id
from public.promise_lists l where l.user_id = p.user_id and l.local_date = p.local_date;
alter table public.promises alter column list_id set not null;

-- No more 3-a-day limit.
alter table public.promises drop constraint promises_position_check;
alter table public.promises drop constraint promises_user_id_local_date_position_key;
alter table public.promises alter column position type integer;
alter table public.promises add constraint promises_position_check check (position >= 1);

create function private.owns_list(lid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.promise_lists where id = lid and user_id = auth.uid());
$$;
create function private.can_see_list(lid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.promise_lists l
    where l.id = lid
      and (l.user_id = auth.uid()
           or (private.are_friends(l.user_id, auth.uid()) and l.feed_expires_at > now()))
  );
$$;
revoke execute on function private.owns_list(uuid), private.can_see_list(uuid) from public, anon;
grant execute on function private.owns_list(uuid), private.can_see_list(uuid) to authenticated;

create policy promise_lists_select on public.promise_lists for select to authenticated
  using (
    user_id = (select auth.uid())
    or (private.are_friends(user_id, (select auth.uid())) and feed_expires_at > now())
  );
create policy promise_lists_insert on public.promise_lists for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy promise_lists_update on public.promise_lists for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy promise_lists_delete on public.promise_lists for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.promise_lists from anon;
revoke insert, update on public.promise_lists from authenticated;
grant insert (user_id, caption, local_date) on public.promise_lists to authenticated;
grant update (caption, archived_at) on public.promise_lists to authenticated;

drop policy promises_select on public.promises;
create policy promises_select on public.promises for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.can_see_list(list_id)
    or exists (select 1 from public.post_promises pp where pp.promise_id = promises.id)
  );
drop policy promises_insert on public.promises;
create policy promises_insert on public.promises for insert to authenticated
  with check (user_id = (select auth.uid()) and private.owns_list(list_id));
revoke insert on public.promises from authenticated;
grant insert (user_id, list_id, local_date, position, text) on public.promises to authenticated;

-- Sanity cap so a list can't grow without bound.
create function public.limit_list_items()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.promises where list_id = new.list_id) >= 30 then
    raise exception 'A list can have at most 30 promises';
  end if;
  return new;
end;
$$;
revoke execute on function public.limit_list_items() from public, anon, authenticated;
create trigger promises_limit_items before insert on public.promises
  for each row execute function public.limit_list_items();
