-- post_promises insert checked promises, whose select policy reads post_promises: infinite recursion.
-- Ownership checks now go through security-definer helpers that bypass RLS.
create or replace function private.owns_promise(pid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.promises where id = pid and user_id = auth.uid());
$$;
create or replace function private.owns_post(pid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.posts where id = pid and author_id = auth.uid());
$$;
revoke execute on function private.owns_promise(uuid), private.owns_post(uuid) from public, anon;
grant execute on function private.owns_promise(uuid), private.owns_post(uuid) to authenticated;

drop policy post_promises_insert on public.post_promises;
create policy post_promises_insert on public.post_promises for insert to authenticated
  with check (private.owns_post(post_id) and private.owns_promise(promise_id));

drop policy pins_insert on public.post_pins;
create policy pins_insert on public.post_pins for insert to authenticated
  with check (user_id = (select auth.uid()) and private.owns_post(post_id));

drop policy post_promises_delete on public.post_promises;
create policy post_promises_delete on public.post_promises for delete to authenticated
  using (private.owns_post(post_id));
