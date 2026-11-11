-- Profiles are visible to yourself and to people you share a friendship row with (pending or accepted).
-- Everyone else is found through search_profiles, which returns a small, limited list.
drop policy profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or (
      not private.is_blocked_between(id, (select auth.uid()))
      and exists (
        select 1 from public.friendships f
        where (f.user_low = profiles.id and f.user_high = (select auth.uid()))
           or (f.user_high = profiles.id and f.user_low = (select auth.uid()))
      )
    )
  );

create function public.search_profiles(p_query text)
returns table (id uuid, username text, display_name text, relation text)
language sql stable security definer set search_path = '' as $$
  with q as (
    select regexp_replace(lower(trim(coalesce(p_query, ''))), '([%_\\])', '\\\1', 'g') as s,
           lower(trim(coalesce(p_query, ''))) as raw
  )
  select p.id, p.username, p.display_name,
    case when f.id is null then 'none'
         when f.status = 'accepted' then 'friends'
         when f.requested_by = auth.uid() then 'sent'
         else 'received' end
  from public.profiles p
  cross join q
  left join public.friendships f
    on f.user_low = least(p.id, auth.uid()) and f.user_high = greatest(p.id, auth.uid())
  where auth.uid() is not null
    and length(q.raw) >= 3
    and p.id <> auth.uid()
    and not private.is_blocked_between(p.id, auth.uid())
    and (p.username like '%' || q.s || '%' or lower(p.display_name) like '%' || q.s || '%')
  order by (p.username = q.raw) desc, (p.username like q.s || '%') desc, p.username
  limit 10;
$$;
revoke execute on function public.search_profiles(text) from public, anon;
grant execute on function public.search_profiles(text) to authenticated;

-- Attach a finished recording (and stats) to an existing post, or create a new post for it.
create function public.finish_session(
  p_post uuid, p_media uuid, p_focus_seconds integer, p_blocks integer, p_breaks integer,
  p_caption text, p_local_date date, p_timezone text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  pid uuid := p_post;
  m record;
  po record;
  prov text;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_focus_seconds is null or p_focus_seconds < 0 or p_focus_seconds > 86400 then
    raise exception 'invalid focus time';
  end if;
  if p_media is not null then
    select owner_id, upload_status into m from public.media where id = p_media;
    if not found or m.owner_id <> uid then raise exception 'media must belong to you'; end if;
    if m.upload_status <> 'uploaded' then raise exception 'media is not uploaded yet'; end if;
  end if;
  prov := case when p_media is null then 'logged' else 'captured' end;

  if pid is null then
    insert into public.posts (author_id, provenance, media_id, caption, focus_seconds, blocks_count, breaks_count, local_date, timezone)
    values (uid, prov, p_media, nullif(trim(p_caption), ''), p_focus_seconds,
            least(greatest(coalesce(p_blocks, 0), 0), 1000), least(greatest(coalesce(p_breaks, 0), 0), 1000),
            p_local_date, p_timezone)
    returning id into pid;
    return pid;
  end if;

  select author_id, media_id, focus_seconds into po from public.posts where id = pid;
  if not found or po.author_id <> uid then raise exception 'post not found'; end if;
  if po.media_id is not null or po.focus_seconds > 0 then
    raise exception 'this post already has a recorded session';
  end if;
  update public.posts set
    provenance = prov,
    media_id = p_media,
    focus_seconds = p_focus_seconds,
    blocks_count = least(greatest(coalesce(p_blocks, 0), 0), 1000),
    breaks_count = least(greatest(coalesce(p_breaks, 0), 0), 1000),
    caption = coalesce(nullif(trim(p_caption), ''), caption),
    feed_expires_at = now() + interval '24 hours'
  where id = pid;
  return pid;
end;
$$;
revoke execute on function public.finish_session(uuid, uuid, integer, integer, integer, text, date, text) from public, anon;
grant execute on function public.finish_session(uuid, uuid, integer, integer, integer, text, date, text) to authenticated;
