create table public.group_sessions (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'lobby' check (status in ('lobby', 'active', 'completed', 'cancelled')),
  config jsonb not null default '{}'::jsonb,
  livekit_room text unique,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz
);

create table public.group_participants (
  group_id uuid not null references public.group_sessions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  state text not null default 'invited' check (state in ('invited', 'joined', 'declined', 'left', 'dropped')),
  joined_at timestamptz,
  left_at timestamptz,
  primary key (group_id, user_id)
);
create index group_participants_user_idx on public.group_participants (user_id);

create table public.group_phases (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.group_sessions (id) on delete cascade,
  seq integer not null check (seq >= 1),
  phase_type text not null check (phase_type in ('focus', 'break', 'long_break')),
  starts_at timestamptz not null,
  planned_ends_at timestamptz not null,
  actual_ended_at timestamptz,
  initiated_by uuid references public.profiles (id) on delete set null,
  unique (group_id, seq),
  check (planned_ends_at > starts_at)
);

create table public.break_snapshots (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.group_sessions (id) on delete cascade,
  phase_id uuid references public.group_phases (id) on delete set null,
  taken_by uuid not null references public.profiles (id) on delete cascade,
  storage_path text not null unique,
  shared boolean not null default false,
  created_at timestamptz not null default now(),
  check (storage_path like taken_by::text || '/%')
);
create index break_snapshots_group_idx on public.break_snapshots (group_id);
create index break_snapshots_phase_idx on public.break_snapshots (phase_id);

create table public.break_snapshot_consents (
  snapshot_id uuid not null references public.break_snapshots (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  agreed boolean not null,
  decided_at timestamptz not null default now(),
  primary key (snapshot_id, user_id)
);
create index break_snapshot_consents_user_idx on public.break_snapshot_consents (user_id);

create table public.live_presence (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  group_id uuid references public.group_sessions (id) on delete set null,
  state text not null check (state in ('focus', 'break')),
  started_at timestamptz not null default now(),
  last_heartbeat_at timestamptz not null default now()
);
create index live_presence_group_idx on public.live_presence (group_id);

alter table public.group_sessions enable row level security;
alter table public.group_participants enable row level security;
alter table public.group_phases enable row level security;
alter table public.break_snapshots enable row level security;
alter table public.break_snapshot_consents enable row level security;
alter table public.live_presence enable row level security;

create function public.is_group_member(gid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_participants gp
    where gp.group_id = gid and gp.user_id = auth.uid()
  );
$$;
revoke execute on function public.is_group_member(uuid) from public, anon;
grant execute on function public.is_group_member(uuid) to authenticated;

create policy group_sessions_select on public.group_sessions for select to authenticated
  using (public.is_group_member(id));
create policy group_participants_select on public.group_participants for select to authenticated
  using (public.is_group_member(group_id));
create policy group_phases_select on public.group_phases for select to authenticated
  using (public.is_group_member(group_id));

create policy break_snapshots_select on public.break_snapshots for select to authenticated
  using (public.is_group_member(group_id));
create policy break_snapshots_insert on public.break_snapshots for insert to authenticated
  with check (taken_by = (select auth.uid()) and public.is_group_member(group_id));

create policy consents_select on public.break_snapshot_consents for select to authenticated
  using (exists (select 1 from public.break_snapshots s where s.id = snapshot_id));
create policy consents_insert on public.break_snapshot_consents for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.break_snapshots s where s.id = snapshot_id)
  );
create policy consents_update on public.break_snapshot_consents for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy presence_select on public.live_presence for select to authenticated
  using (
    user_id = (select auth.uid())
    or (public.are_friends(user_id, (select auth.uid()))
        and last_heartbeat_at > now() - interval '2 minutes')
  );
create policy presence_insert on public.live_presence for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy presence_update on public.live_presence for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy presence_delete on public.live_presence for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.group_sessions, public.group_participants, public.group_phases,
  public.break_snapshots, public.break_snapshot_consents, public.live_presence from anon;
revoke insert, update, delete on public.group_sessions, public.group_participants, public.group_phases from authenticated;
revoke update, delete on public.break_snapshots from authenticated;

create function public.snapshot_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.break_snapshot_consents (snapshot_id, user_id, agreed)
  values (new.id, new.taken_by, true);
  return new;
end;
$$;

create function public.update_snapshot_shared()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.break_snapshots s
  set shared = (
    (select count(*) from public.break_snapshot_consents c where c.snapshot_id = s.id and c.agreed)
    >= (select count(*) from public.group_participants gp where gp.group_id = s.group_id and gp.state = 'joined')
  )
  where s.id = new.snapshot_id;
  return new;
end;
$$;
revoke execute on function public.snapshot_after_insert() from public, anon, authenticated;
revoke execute on function public.update_snapshot_shared() from public, anon, authenticated;

create trigger snapshot_auto_consent after insert on public.break_snapshots
  for each row execute function public.snapshot_after_insert();
create trigger snapshot_consent_changed after insert or update on public.break_snapshot_consents
  for each row execute function public.update_snapshot_shared();
