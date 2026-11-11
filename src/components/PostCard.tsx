import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { isLive, videoUrl, type Bundle } from '../lib/posts'
import { ago, fmtFocus, timeLeft } from '../lib/time'

type Comment = { id: string; author_id: string; username: string; display_name: string; body: string; created_at: string }

type Props = {
  b: Bundle
  me: string
  onChanged: () => void
  // owner controls (archive / own posts)
  owner?: boolean
}

export default function PostCard({ b, me, onChanged, owner }: Props) {
  const { post, author, thumb, items, reactions, mine, pinned } = b
  const live = isLive(post)
  const done = items.filter(i => i.status === 'fulfilled').length
  const hasStats = (post.focus_seconds ?? 0) > 0

  const [err, setErr] = useState('')
  const [video, setVideo] = useState('')
  const [open, setOpen] = useState(false)
  const [comments, setComments] = useState<Comment[] | null>(null)
  const [text, setText] = useState('')

  async function react() {
    setErr('')
    const { error } = mine
      ? await supabase.from('reactions').delete().eq('post_id', post.id).eq('user_id', me)
      : await supabase.from('reactions').insert({ post_id: post.id, user_id: me, kind: 'fire' })
    if (error) setErr(live ? error.message : 'Reactions are closed on this post.'); else onChanged()
  }

  async function togglePin() {
    setErr('')
    const { error } = pinned
      ? await supabase.from('post_pins').delete().eq('post_id', post.id).eq('user_id', me)
      : await supabase.rpc('pin_post', { p_post: post.id })
    if (error) setErr(error.message); else onChanged()
  }

  async function remove() {
    if (!confirm('Delete this post? This cannot be undone.')) return
    const { error } = await supabase.from('posts').delete().eq('id', post.id)
    if (error) setErr(error.message); else onChanged()
  }

  async function report() {
    const reason = prompt('What is wrong with this post?')?.trim()
    if (!reason) return
    const { error } = await supabase.from('reports').insert({ reporter_id: me, target_type: 'post', target_id: post.id, reason: reason.slice(0, 500) })
    setErr(error ? error.message : 'Thanks, we will look at it.')
  }

  async function play() {
    if (!post.media_id) return
    const url = await videoUrl(post.media_id)
    if (url) setVideo(url); else setErr('Could not load the video.')
  }

  async function loadComments() {
    const { data, error } = await supabase.rpc('get_comments', { p_post: post.id })
    if (error) setErr(error.message); else setComments((data as Comment[]) ?? [])
  }
  async function toggleComments() {
    const next = !open
    setOpen(next)
    if (next && comments === null) await loadComments()
  }
  async function sendComment(e: React.FormEvent) {
    e.preventDefault()
    const body = text.trim()
    if (!body) return
    setErr('')
    const { error } = await supabase.from('comments').insert({ post_id: post.id, author_id: me, body })
    if (error) return setErr(live ? error.message : 'Comments are closed on this post.')
    setText(''); await loadComments()
  }
  async function deleteComment(id: string) {
    const { error } = await supabase.from('comments').delete().eq('id', id)
    if (error) setErr(error.message); else await loadComments()
  }

  return (
    <div className="card">
      <div className="row">
        <div className="avatar">{author?.display_name[0]?.toUpperCase() ?? '?'}</div>
        <div className="grow">
          <div>
            {author && author.id !== me
              ? <Link to={`/u/${author.username}`} style={{ color: 'inherit', textDecoration: 'none' }}>{author.display_name}</Link>
              : author?.display_name ?? 'Unknown'}
          </div>
          <div className="muted">{ago(post.created_at)} · {live ? timeLeft(post.feed_expires_at) : 'archived'}</div>
        </div>
        {pinned && <span className="chip green">Pinned</span>}
        {post.kind === 'coop' && <span className="chip green">Co-op</span>}
        {items.length > 0 && <span className="chip">{done}/{items.length}</span>}
      </div>

      {post.caption && <div className="mid" style={{ margin: '10px 0 4px' }}>{post.caption}</div>}

      {post.media_id && (
        video
          ? <video src={video} controls playsInline loop autoPlay muted style={{ width: '100%', borderRadius: 12, margin: '10px 0', background: '#000' }} />
          : <div className="post-media" onClick={play} style={{ cursor: 'pointer', position: 'relative' }}>
              {thumb ? <img src={thumb} alt="" /> : 'Timelapse'}
              <span style={{ position: 'absolute', fontSize: 34 }}>▶</span>
            </div>
      )}

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
        {hasStats && <>
          <div className="stat"><b>{fmtFocus(post.focus_seconds)}</b><span className="muted">focused</span></div>
          <div className="stat"><b>{post.blocks_count ?? 0}</b><span className="muted">blocks</span></div>
        </>}
        <div className="row" style={{ marginLeft: 'auto', gap: 6 }}>
          <button className="btn small ghost" onClick={toggleComments} aria-label="Comments">💬</button>
          <button className={'btn small ' + (mine ? '' : 'ghost')} onClick={react} aria-label="React">🔥 {reactions || ''}</button>
        </div>
      </div>

      {owner && (
        <div className="row" style={{ marginTop: 8 }}>
          <button className="link" onClick={togglePin}>{pinned ? 'Unpin' : 'Pin to profile'}</button>
          <button className="link muted" onClick={remove}>Delete</button>
        </div>
      )}

      {!owner && <div style={{ marginTop: 6 }}><button className="link muted" onClick={report}>Report</button></div>}

      {open && (
        <div style={{ marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
          {comments === null && <div className="muted">Loading…</div>}
          {comments?.length === 0 && <div className="muted">No comments yet.</div>}
          {comments?.map(c => (
            <div key={c.id} className="row" style={{ marginBottom: 8, alignItems: 'flex-start' }}>
              <div className="grow"><b style={{ fontSize: 13 }}>{c.display_name}</b> <span className="mid">{c.body}</span></div>
              {(c.author_id === me || post.author_id === me) && <button className="link muted" onClick={() => deleteComment(c.id)}>Delete</button>}
            </div>
          ))}
          {live && (
            <form className="row" onSubmit={sendComment}>
              <input className="input" style={{ marginBottom: 0 }} placeholder="Add a comment" maxLength={300} value={text} onChange={e => setText(e.target.value)} />
              <button className="btn small">Send</button>
            </form>
          )}
        </div>
      )}
      {err && <div className="err">{err}</div>}
    </div>
  )
}
