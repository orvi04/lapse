-- Web Push subscriptions (replaces APNs tokens for the PWA).
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
create policy push_subscriptions_all on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.push_subscriptions from anon;

-- Authors mark their own promises done (or undo) without having to post.
create function public.set_promise_status(p_id uuid, p_fulfilled boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  update public.promises
  set status = case when p_fulfilled then 'fulfilled' else 'pending' end,
      fulfilled_at = case when p_fulfilled then now() else null end
  where id = p_id and user_id = uid;
  if not found then raise exception 'promise not found'; end if;
end;
$$;
revoke execute on function public.set_promise_status(uuid, boolean) from public, anon;
grant execute on function public.set_promise_status(uuid, boolean) to authenticated;
