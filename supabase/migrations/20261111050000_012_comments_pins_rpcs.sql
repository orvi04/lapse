-- Comments with author names, even when the commenter is only a friend of the post's author.
create function public.get_comments(p_post uuid)
returns table (id uuid, author_id uuid, username text, display_name text, body text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.id, c.author_id, p.username, p.display_name, c.body, c.created_at
  from public.comments c
  join public.profiles p on p.id = c.author_id
  where c.post_id = p_post
    and auth.uid() is not null
    and private.can_see_post(p_post)
    and not private.is_blocked_between(c.author_id, auth.uid())
  order by c.created_at;
$$;
revoke execute on function public.get_comments(uuid) from public, anon;
grant execute on function public.get_comments(uuid) to authenticated;

-- Pin a post into the first free slot (max 3). Runs as the caller, so RLS applies.
create function public.pin_post(p_post uuid)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  uid uuid := auth.uid();
  pos integer;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select g into pos from generate_series(1, 3) g
  where not exists (select 1 from public.post_pins where user_id = uid and position = g)
  order by g limit 1;
  if pos is null then raise exception 'You can pin up to 3 posts. Unpin one first.'; end if;
  begin
    insert into public.post_pins (user_id, post_id, position) values (uid, p_post, pos);
  exception when unique_violation then
    raise exception 'This post is already pinned.';
  end;
  return pos;
end;
$$;
revoke execute on function public.pin_post(uuid) from public, anon;
grant execute on function public.pin_post(uuid) to authenticated;
