-- One thing, not two: a post carries its promises (checklist) and an optional caption.
-- Footage and focus stats can be attached later. promise_lists and post_promises are retired.

alter table public.promises add column post_id uuid references public.posts (id) on delete cascade;
create index promises_post_idx on public.promises (post_id);

-- Carry existing lists over as posts (reusing the list id as the post id).
insert into public.posts (id, author_id, provenance, caption, local_date, timezone, created_at, feed_expires_at)
select l.id, l.user_id, 'logged', l.caption, l.local_date, coalesce(pr.timezone, 'UTC'), l.created_at, l.feed_expires_at
from public.promise_lists l join public.profiles pr on pr.id = l.user_id;
update public.promises set post_id = list_id;
alter table public.promises alter column post_id set not null;

-- Retire the old structures.
drop policy promises_select on public.promises;
drop policy promises_insert on public.promises;
drop trigger promises_limit_items on public.promises;
drop function public.limit_list_items();
alter table public.promises drop column list_id;
drop table public.promise_lists;
drop function private.owns_list(uuid);
drop function private.can_see_list(uuid);
drop table public.post_promises;
drop function public.mark_promise_fulfilled();

create function private.can_see_post(pid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.posts p
    where p.id = pid
      and (
        p.author_id = auth.uid()
        or (
          private.are_friends(p.author_id, auth.uid())
          and (p.feed_expires_at > now()
               or exists (select 1 from public.post_pins pn where pn.post_id = p.id))
        )
      )
  );
$$;
revoke execute on function private.can_see_post(uuid) from public, anon;
grant execute on function private.can_see_post(uuid) to authenticated;

create policy promises_select on public.promises for select to authenticated
  using (user_id = (select auth.uid()) or private.can_see_post(post_id));
create policy promises_insert on public.promises for insert to authenticated
  with check (user_id = (select auth.uid()) and private.owns_post(post_id));
revoke insert on public.promises from authenticated;
grant insert (user_id, post_id, local_date, position, text) on public.promises to authenticated;

create function public.limit_post_items()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.promises where post_id = new.post_id) >= 30 then
    raise exception 'A post can have at most 30 promises';
  end if;
  return new;
end;
$$;
revoke execute on function public.limit_post_items() from public, anon, authenticated;
create trigger promises_limit_items before insert on public.promises
  for each row execute function public.limit_post_items();

-- Create a post and its promises in one step (runs as the caller, so RLS applies).
create function public.create_post(p_caption text, p_items text[], p_local_date date, p_timezone text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  uid uuid := auth.uid();
  pid uuid;
  t text;
  i int := 0;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  insert into public.posts (author_id, provenance, caption, local_date, timezone)
  values (uid, 'logged', nullif(trim(p_caption), ''), p_local_date, p_timezone)
  returning id into pid;
  foreach t in array coalesce(p_items, '{}') loop
    if trim(t) <> '' then
      i := i + 1;
      insert into public.promises (user_id, post_id, local_date, position, text)
      values (uid, pid, p_local_date, i, trim(t));
    end if;
  end loop;
  return pid;
end;
$$;
revoke execute on function public.create_post(text, text[], date, text) from public, anon;
grant execute on function public.create_post(text, text[], date, text) to authenticated;
