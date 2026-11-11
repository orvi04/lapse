create table public.promises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  local_date date not null,
  position smallint not null check (position between 1 and 3),
  text text not null check (char_length(text) between 1 and 140),
  status text not null default 'pending' check (status in ('pending', 'fulfilled')),
  fulfilled_at timestamptz,
  expires_on date generated always as (local_date + 7) stored,
  created_at timestamptz not null default now(),
  unique (user_id, local_date, position)
);
create index promises_user_date_idx on public.promises (user_id, local_date);

create table public.media (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  storage_path text not null unique,
  thumb_path text,
  duration_ms integer check (duration_ms > 0 and duration_ms <= 120000),
  frame_count integer check (frame_count > 0),
  width integer check (width > 0),
  height integer check (height > 0),
  codec text check (codec in ('h264', 'hevc')),
  bytes bigint check (bytes > 0 and bytes <= 52428800),
  capture_interval_s numeric(6, 2) check (capture_interval_s > 0),
  upload_status text not null default 'pending' check (upload_status in ('pending', 'uploaded', 'failed')),
  created_at timestamptz not null default now(),
  check (storage_path like owner_id::text || '/%'),
  check (thumb_path is null or thumb_path like owner_id::text || '/%')
);
create index media_owner_idx on public.media (owner_id);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null default 'solo' check (kind in ('solo', 'coop')),
  group_id uuid references public.group_sessions (id) on delete set null,
  provenance text not null check (provenance in ('captured', 'imported', 'logged')),
  media_id uuid references public.media (id) on delete set null,
  caption text check (char_length(caption) <= 280),
  focus_seconds integer not null default 0 check (focus_seconds >= 0),
  blocks_count smallint not null default 0 check (blocks_count >= 0),
  breaks_count smallint not null default 0 check (breaks_count >= 0),
  local_date date not null,
  timezone text not null,
  created_at timestamptz not null default now(),
  feed_expires_at timestamptz not null default (now() + interval '24 hours'),
  constraint posts_media_matches_provenance check ((provenance = 'logged') = (media_id is null))
);
create index posts_author_created_idx on public.posts (author_id, created_at desc);
create index posts_feed_idx on public.posts (feed_expires_at desc);
create index posts_media_idx on public.posts (media_id);
create unique index posts_one_per_group_idx on public.posts (author_id, group_id) where group_id is not null;
create index posts_group_idx on public.posts (group_id);

create table public.post_promises (
  post_id uuid not null references public.posts (id) on delete cascade,
  promise_id uuid not null references public.promises (id) on delete cascade,
  primary key (post_id, promise_id)
);
create index post_promises_promise_idx on public.post_promises (promise_id);

create table public.post_pins (
  user_id uuid not null references public.profiles (id) on delete cascade,
  post_id uuid not null references public.posts (id) on delete cascade,
  position smallint not null check (position between 1 and 3),
  created_at timestamptz not null default now(),
  primary key (user_id, post_id),
  unique (user_id, position)
);
create index post_pins_post_idx on public.post_pins (post_id);

create table public.reactions (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('fire', 'clap', 'heart', 'focus')),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index reactions_user_idx on public.reactions (user_id);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 300),
  created_at timestamptz not null default now()
);
create index comments_post_idx on public.comments (post_id, created_at);
create index comments_author_idx on public.comments (author_id);

alter table public.promises enable row level security;
alter table public.media enable row level security;
alter table public.posts enable row level security;
alter table public.post_promises enable row level security;
alter table public.post_pins enable row level security;
alter table public.reactions enable row level security;
alter table public.comments enable row level security;

-- Pins first: posts policy refers to them.
create policy pins_select on public.post_pins for select to authenticated
  using (user_id = (select auth.uid()) or public.are_friends(user_id, (select auth.uid())));
create policy pins_insert on public.post_pins for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.posts p where p.id = post_id and p.author_id = (select auth.uid()))
  );
create policy pins_update on public.post_pins for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy pins_delete on public.post_pins for delete to authenticated
  using (user_id = (select auth.uid()));

-- Posts: author always; friends only while on the rolling 24h feed, or if pinned.
create policy posts_select on public.posts for select to authenticated
  using (
    author_id = (select auth.uid())
    or (
      public.are_friends(author_id, (select auth.uid()))
      and (
        feed_expires_at > now()
        or exists (select 1 from public.post_pins pn where pn.post_id = posts.id)
      )
    )
  );
create policy posts_insert on public.posts for insert to authenticated
  with check (author_id = (select auth.uid()));
create policy posts_update on public.posts for update to authenticated
  using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));
create policy posts_delete on public.posts for delete to authenticated
  using (author_id = (select auth.uid()));

create policy media_select on public.media for select to authenticated
  using (
    owner_id = (select auth.uid())
    or exists (select 1 from public.posts p where p.media_id = media.id)
  );
create policy media_insert on public.media for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy media_update on public.media for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy media_delete on public.media for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy promises_select on public.promises for select to authenticated
  using (
    user_id = (select auth.uid())
    or (
      public.are_friends(user_id, (select auth.uid()))
      and (
        (status = 'pending' and expires_on >= current_date)
        or exists (select 1 from public.post_promises pp where pp.promise_id = promises.id)
      )
    )
  );
create policy promises_insert on public.promises for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy promises_update on public.promises for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy promises_delete on public.promises for delete to authenticated
  using (user_id = (select auth.uid()));

create policy post_promises_select on public.post_promises for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id));
create policy post_promises_insert on public.post_promises for insert to authenticated
  with check (
    exists (select 1 from public.posts p where p.id = post_id and p.author_id = (select auth.uid()))
    and exists (select 1 from public.promises pr where pr.id = promise_id and pr.user_id = (select auth.uid()))
  );
create policy post_promises_delete on public.post_promises for delete to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id and p.author_id = (select auth.uid())));

-- Reactions and comments only while the post is on the feed.
create policy reactions_select on public.reactions for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id));
create policy reactions_insert on public.reactions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.posts p where p.id = post_id and p.feed_expires_at > now())
  );
create policy reactions_update on public.reactions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy reactions_delete on public.reactions for delete to authenticated
  using (user_id = (select auth.uid()));

create policy comments_select on public.comments for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id));
create policy comments_insert on public.comments for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and exists (select 1 from public.posts p where p.id = post_id and p.feed_expires_at > now())
  );
create policy comments_delete on public.comments for delete to authenticated
  using (
    author_id = (select auth.uid())
    or exists (select 1 from public.posts p where p.id = post_id and p.author_id = (select auth.uid()))
  );

-- Column-level privileges: clients cannot set server-controlled fields.
revoke all on public.promises, public.media, public.posts, public.post_promises,
  public.post_pins, public.reactions, public.comments from anon;

revoke insert, update on public.promises from authenticated;
grant insert (user_id, local_date, position, text) on public.promises to authenticated;
grant update (text) on public.promises to authenticated;

revoke insert, update on public.media from authenticated;
grant insert (id, owner_id, storage_path, thumb_path, duration_ms, frame_count, width, height, codec, bytes, capture_interval_s) on public.media to authenticated;
grant update (upload_status, thumb_path) on public.media to authenticated;

revoke insert, update on public.posts from authenticated;
grant insert (id, author_id, group_id, provenance, media_id, caption, focus_seconds, blocks_count, breaks_count, local_date, timezone) on public.posts to authenticated;
grant update (caption) on public.posts to authenticated;

-- Server-side validation.
create function public.validate_post()
returns trigger language plpgsql security definer set search_path = '' as $$
declare m record;
begin
  if new.media_id is not null then
    select owner_id, upload_status into m from public.media where id = new.media_id;
    if not found or m.owner_id <> new.author_id then
      raise exception 'media must belong to the author';
    end if;
    if m.upload_status <> 'uploaded' then
      raise exception 'media must be uploaded before posting';
    end if;
  end if;
  if new.group_id is not null then
    if not exists (
      select 1 from public.group_participants gp
      where gp.group_id = new.group_id and gp.user_id = new.author_id
        and gp.state in ('joined', 'left', 'dropped')
    ) then
      raise exception 'author was not in this group session';
    end if;
    new.kind := 'coop';
  else
    new.kind := 'solo';
  end if;
  return new;
end;
$$;

create function public.mark_promise_fulfilled()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.promises
  set status = 'fulfilled', fulfilled_at = now()
  where id = new.promise_id and status = 'pending';
  return new;
end;
$$;

create function public.verify_media_uploaded()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.upload_status = 'uploaded' and old.upload_status is distinct from 'uploaded' then
    if not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'timelapses' and o.name = new.storage_path
    ) then
      raise exception 'file not found in storage';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.validate_post() from public, anon, authenticated;
revoke execute on function public.mark_promise_fulfilled() from public, anon, authenticated;
revoke execute on function public.verify_media_uploaded() from public, anon, authenticated;

create trigger posts_validate before insert on public.posts
  for each row execute function public.validate_post();
create trigger post_promises_fulfil after insert on public.post_promises
  for each row execute function public.mark_promise_fulfilled();
create trigger media_verify_upload before update on public.media
  for each row execute function public.verify_media_uploaded();
