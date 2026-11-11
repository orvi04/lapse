import { useCallback, useEffect, useState } from 'react'
import { supabase, type Post, type Profile, type Promise_ } from '../lib/supabase'
import { ago, fmtFocus, timeLeft } from '../lib/time'

type Item = { post: Post; author?: Profile; thumb?: string; items: Promise_[]; reactions: number; mine: boolean }

export default function Feed() {
  const [rows, setRows] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [uid, setUid] = useState('')

  const load = useCallback(async () => {
    const { data: u } = await supabase.auth.getUser()
    const me = u.user?.id ?? ''
    setUid(me)
    const { data } = await supabase.from('posts')
      .select('id,author_id,kind,provenance,media_id,caption,focus_seconds,blocks_count,breaks_count,local_date,created_at,feed_expires_at')
      .gt('feed_expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(50)
    const posts = (data as Post[]) ?? []
    const authorIds = [...new Set(posts.map(p => p.author_id))]
    const mediaIds = posts.map(p => p.media_id).filter(Boolean) as string[]
    const postIds = posts.map(p => p.id)
    const [{ data: ps }, { data: ms }, { data: rs }, { data: prs }] = await Promise.all([
      authorIds.length ? supabase.from('profiles').select('id,username,display_name,avatar_path,timezone').in('id', authorIds) : { data: [] },
      mediaIds.length ? supabase.from('media').select('id,thumb_path').in('id', mediaIds) : { data: [] },
      postIds.length ? supabase.from('reactions').select('post_id,user_id,kind').in('post_id', postIds) : { data: [] },
      postIds.length ? supabase.from('promises').select('id,post_id,user_id,position,text,status,fulfilled_at').in('post_id', postIds).order('position') : { data: [] },
    ])
    const authors = new Map(((ps as Profile[]) ?? []).map(p => [p.id, p]))
    const thumbPaths = new Map(((ms as { id: string; thumb_path: string | null }[]) ?? []).map(m => [m.id, m.thumb_path]))
    const reacts = (rs as { post_id: string; user_id: string; kind: string }[]) ?? []
    const proms = (prs as Promise_[]) ?? []
    const out: Item[] = []
    for (const post of posts) {
      const path = post.media_id ? thumbPaths.get(post.media_id) : null
      let thumb: string | undefined
      if (path) {
        const { data: s } = await supabase.storage.from('thumbnails').createSignedUrl(path, 3600)
        thumb = s?.signedUrl
      }
      out.push({
        post, author: authors.get(post.author_id), thumb,
        items: proms.filter(p => p.post_id === post.id),
        reactions: reacts.filter(r => r.post_id === post.id).length,
        mine: reacts.some(r => r.post_id === post.id && r.user_id === me),
      })
    }
    setRows(out); setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])

  async function react(id: string, mine: boolean) {
    if (mine) await supabase.from('reactions').delete().eq('post_id', id).eq('user_id', uid)
    else await supabase.from('reactions').insert({ post_id: id, user_id: uid, kind: 'fire' })
    void load()
  }

  return (
    <div className="screen">
      <h2 className="title">Today</h2>
      <p className="sub">Posts from you and your friends. They leave the feed after 24 hours.</p>
      {loading && <p className="muted">Loading…</p>}
      {!loading && rows.length === 0 && <p className="muted">Nothing here yet. Tap + to post, or add friends.</p>}
      {rows.map(({ post, author, thumb, items, reactions, mine }) => {
        const done = items.filter(i => i.status === 'fulfilled').length
        const hasStats = post.focus_seconds && post.focus_seconds > 0
        return (
          <div className="card" key={post.id}>
            <div className="row">
              <div className="avatar">{author?.display_name[0]?.toUpperCase() ?? '?'}</div>
              <div className="grow"><div>{author?.display_name ?? 'Unknown'}</div><div className="muted">{ago(post.created_at)} · {timeLeft(post.feed_expires_at)}</div></div>
              {post.kind === 'coop' && <span className="chip green">Co-op</span>}
              {items.length > 0 && <span className="chip">{done}/{items.length}</span>}
            </div>
            {post.caption && <div className="mid" style={{ margin: '10px 0 4px' }}>{post.caption}</div>}
            {(thumb || post.media_id) && <div className="post-media">{thumb ? <img src={thumb} alt="" /> : 'Timelapse'}</div>}
            {items.length > 0 && (
              <div style={{ marginTop: 10 }}>
                {items.map(i => (
                  <div key={i.id} className="row" style={{ marginBottom: 8 }}>
                    <span className={'tick' + (i.status === 'fulfilled' ? ' done' : '')} style={{ cursor: 'default', width: 22, height: 22 }}>✓</span>
                    <div className="grow" style={{ textDecoration: i.status === 'fulfilled' ? 'line-through' : 'none', color: i.status === 'fulfilled' ? 'var(--mute)' : 'inherit' }}>{i.text}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="stats">
              {hasStats ? <>
                <div className="stat"><b>{fmtFocus(post.focus_seconds)}</b><span className="muted">focused</span></div>
                <div className="stat"><b>{post.blocks_count ?? 0}</b><span className="muted">blocks</span></div>
              </> : null}
              <div style={{ marginLeft: 'auto' }}>
                <button className={'btn small ' + (mine ? '' : 'ghost')} onClick={() => react(post.id, mine)}>🔥 {reactions || ''}</button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
