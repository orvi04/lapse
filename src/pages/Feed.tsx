import { useCallback, useEffect, useState } from 'react'
import { supabase, type Post, type Profile, type Promise_, type PromiseList } from '../lib/supabase'
import { ago, fmtFocus, timeLeft } from '../lib/time'

type ListItem = { list: PromiseList; author?: Profile; items: Promise_[] }
type Item = { post: Post; author?: Profile; thumb?: string; reactions: number; mine: boolean }
const EMOJI: Record<string, string> = { fire: '🔥', clap: '👏', heart: '❤️', focus: '🎯' }

export default function Feed() {
  const [items, setItems] = useState<Item[]>([])
  const [lists, setLists] = useState<ListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [uid, setUid] = useState('')

  const load = useCallback(async () => {
    const { data: u } = await supabase.auth.getUser()
    setUid(u.user?.id ?? '')
    const { data } = await supabase.from('posts')
      .select('id,author_id,kind,provenance,media_id,caption,focus_seconds,blocks_count,breaks_count,local_date,created_at,feed_expires_at')
      .gt('feed_expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(50)
    const posts = (data as Post[]) ?? []
    const authorIds = [...new Set(posts.map(p => p.author_id))]
    const mediaIds = posts.map(p => p.media_id).filter(Boolean) as string[]
    const postIds = posts.map(p => p.id)
    const [{ data: ps }, { data: ms }, { data: rs }] = await Promise.all([
      authorIds.length ? supabase.from('profiles').select('id,username,display_name,avatar_path,timezone').in('id', authorIds) : { data: [] },
      mediaIds.length ? supabase.from('media').select('id,thumb_path').in('id', mediaIds) : { data: [] },
      postIds.length ? supabase.from('reactions').select('post_id,user_id,kind').in('post_id', postIds) : { data: [] },
    ])
    const authors = new Map(((ps as Profile[]) ?? []).map(p => [p.id, p]))
    const thumbPaths = new Map(((ms as { id: string; thumb_path: string | null }[]) ?? []).map(m => [m.id, m.thumb_path]))
    const reacts = (rs as { post_id: string; user_id: string; kind: string }[]) ?? []
    const out: Item[] = []
    for (const post of posts) {
      const path = post.media_id ? thumbPaths.get(post.media_id) : null
      let thumb: string | undefined
      if (path) {
        const { data: s } = await supabase.storage.from('thumbnails').createSignedUrl(path, 3600)
        thumb = s?.signedUrl
      }
      const mine = reacts.some(r => r.post_id === post.id && r.user_id === (u.user?.id ?? ''))
      out.push({ post, author: authors.get(post.author_id), thumb, reactions: reacts.filter(r => r.post_id === post.id).length, mine })
    }
    const { data: ls } = await supabase.from('promise_lists')
      .select('id,user_id,caption,local_date,created_at,feed_expires_at,archived_at')
      .gt('feed_expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(30)
    const listRows = (ls as PromiseList[]) ?? []
    const listIds = listRows.map(l => l.id)
    const { data: lps } = listIds.length
      ? await supabase.from('promises').select('id,list_id,user_id,position,text,status,fulfilled_at').in('list_id', listIds).order('position')
      : { data: [] }
    const missing = [...new Set(listRows.map(l => l.user_id))].filter(id => !authors.has(id))
    if (missing.length) {
      const { data: more } = await supabase.from('profiles').select('id,username,display_name,avatar_path,timezone').in('id', missing)
      for (const p of (more as Profile[]) ?? []) authors.set(p.id, p)
    }
    const proms = (lps as Promise_[]) ?? []
    setLists(listRows.map(list => ({ list, author: authors.get(list.user_id), items: proms.filter(p => p.list_id === list.id) })))
    setItems(out); setLoading(false)
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
      {!loading && items.length === 0 && lists.length === 0 && <p className="muted">Nothing here yet. Tap + to start a session, or add friends.</p>}
      {lists.map(({ list, author, items: its }) => {
        const done = its.filter(i => i.status === 'fulfilled').length
        return (
          <div className="card" key={list.id}>
            <div className="row">
              <div className="avatar">{author?.display_name[0]?.toUpperCase() ?? '?'}</div>
              <div className="grow"><div>{author?.display_name ?? 'Unknown'}</div><div className="muted">{ago(list.created_at)} · {timeLeft(list.feed_expires_at)}</div></div>
              <span className="chip">Promises {done}/{its.length}</span>
            </div>
            {list.caption && <div className="mid" style={{ margin: '10px 0 6px' }}>{list.caption}</div>}
            <div style={{ marginTop: 10 }}>
              {its.map(p => (
                <div key={p.id} className="row" style={{ marginBottom: 8 }}>
                  <span className={'tick' + (p.status === 'fulfilled' ? ' done' : '')} style={{ cursor: 'default', width: 22, height: 22 }}>✓</span>
                  <div className="grow" style={{ textDecoration: p.status === 'fulfilled' ? 'line-through' : 'none', color: p.status === 'fulfilled' ? 'var(--mute)' : 'inherit' }}>{p.text}</div>
                </div>
              ))}
            </div>
          </div>
        )
      })}
      {items.map(({ post, author, thumb, reactions, mine }) => (
        <div className="card" key={post.id}>
          <div className="row">
            <div className="avatar">{author?.display_name[0]?.toUpperCase() ?? '?'}</div>
            <div className="grow"><div>{author?.display_name ?? 'Unknown'}</div><div className="muted">{ago(post.created_at)} · {timeLeft(post.feed_expires_at)}</div></div>
            {post.provenance !== 'captured' && <span className="chip orange">{post.provenance}</span>}
            {post.kind === 'coop' && <span className="chip green">Co-op</span>}
          </div>
          <div className="post-media">{thumb ? <img src={thumb} alt="" /> : post.provenance === 'logged' ? 'Logged session' : 'Timelapse'}</div>
          {post.caption && <div className="mid">{post.caption}</div>}
          <div className="stats">
            <div className="stat"><b>{fmtFocus(post.focus_seconds)}</b><span className="muted">focused</span></div>
            <div className="stat"><b>{post.blocks_count ?? 0}</b><span className="muted">blocks</span></div>
            <div className="stat"><b>{post.breaks_count ?? 0}</b><span className="muted">breaks</span></div>
            <div style={{ marginLeft: 'auto' }}>
              <button className={'btn small ' + (mine ? '' : 'ghost')} onClick={() => react(post.id, mine)}>{EMOJI.fire} {reactions || ''}</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
