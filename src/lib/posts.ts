import { supabase, type Post, type Profile, type Promise_ } from './supabase'

export const POST_COLS =
  'id,author_id,kind,provenance,media_id,caption,focus_seconds,blocks_count,breaks_count,local_date,created_at,feed_expires_at'

export type Bundle = {
  post: Post
  author?: Profile
  thumb?: string
  items: Promise_[]
  reactions: number
  mine: boolean
  pinned: boolean
}

export const isLive = (p: Post) => new Date(p.feed_expires_at).getTime() > Date.now()

export async function loadBundles(posts: Post[], me: string): Promise<Bundle[]> {
  if (posts.length === 0) return []
  const authorIds = [...new Set(posts.map(p => p.author_id))]
  const mediaIds = posts.map(p => p.media_id).filter(Boolean) as string[]
  const postIds = posts.map(p => p.id)
  const [{ data: ps }, { data: ms }, { data: rs }, { data: prs }, { data: pins }] = await Promise.all([
    supabase.from('profiles').select('id,username,display_name,avatar_path,timezone').in('id', authorIds),
    mediaIds.length ? supabase.from('media').select('id,thumb_path').in('id', mediaIds) : Promise.resolve({ data: [] }),
    supabase.from('reactions').select('post_id,user_id,kind').in('post_id', postIds),
    supabase.from('promises').select('id,post_id,user_id,position,text,status,fulfilled_at').in('post_id', postIds).order('position'),
    supabase.from('post_pins').select('post_id').in('post_id', postIds),
  ])
  const authors = new Map(((ps as Profile[]) ?? []).map(p => [p.id, p]))
  const thumbPaths = new Map(((ms as { id: string; thumb_path: string | null }[]) ?? []).map(m => [m.id, m.thumb_path]))
  const reacts = (rs as { post_id: string; user_id: string }[]) ?? []
  const proms = (prs as Promise_[]) ?? []
  const pinned = new Set(((pins as { post_id: string }[]) ?? []).map(p => p.post_id))

  const thumbs = await Promise.all(posts.map(async p => {
    const path = p.media_id ? thumbPaths.get(p.media_id) : null
    if (!path) return undefined
    const { data } = await supabase.storage.from('thumbnails').createSignedUrl(path, 3600)
    return data?.signedUrl
  }))

  return posts.map((post, i) => ({
    post,
    author: authors.get(post.author_id),
    thumb: thumbs[i],
    items: proms.filter(x => x.post_id === post.id),
    reactions: reacts.filter(r => r.post_id === post.id).length,
    mine: reacts.some(r => r.post_id === post.id && r.user_id === me),
    pinned: pinned.has(post.id),
  }))
}

export async function videoUrl(mediaId: string): Promise<string | null> {
  const { data: m } = await supabase.from('media').select('storage_path').eq('id', mediaId).maybeSingle()
  if (!m) return null
  const { data } = await supabase.storage.from('timelapses').createSignedUrl((m as { storage_path: string }).storage_path, 3600)
  return data?.signedUrl ?? null
}
