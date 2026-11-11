import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, type Post, type Promise_ } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { todayLocal, ago, timeLeft } from '../lib/time'

export default function Promises() {
  const { session } = useAuth()
  const uid = session!.user.id
  const [posts, setPosts] = useState<Post[]>([])
  const [items, setItems] = useState<Promise_[]>([])
  const [showDone, setShowDone] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    const { data: ps } = await supabase.from('posts')
      .select('id,author_id,kind,provenance,media_id,caption,focus_seconds,blocks_count,breaks_count,local_date,created_at,feed_expires_at')
      .eq('author_id', uid).order('created_at', { ascending: false }).limit(100)
    const list = (ps as Post[]) ?? []
    const { data: pr } = list.length
      ? await supabase.from('promises').select('id,post_id,user_id,position,text,status,fulfilled_at').in('post_id', list.map(p => p.id)).order('position')
      : { data: [] }
    setPosts(list); setItems((pr as Promise_[]) ?? [])
  }, [uid])
  useEffect(() => { void load() }, [load])

  async function toggle(p: Promise_) {
    const { error } = await supabase.rpc('set_promise_status', { p_id: p.id, p_fulfilled: p.status !== 'fulfilled' })
    if (error) setErr(error.message); else void load()
  }
  async function addItem(postId: string, text: string) {
    const count = items.filter(i => i.post_id === postId).length
    const { error } = await supabase.from('promises').insert({ user_id: uid, post_id: postId, local_date: todayLocal(), position: count + 1, text })
    if (error) setErr(error.message); else void load()
  }
  async function remove(p: Post) {
    if (!confirm('Delete this post and its promises?')) return
    const { error } = await supabase.from('posts').delete().eq('id', p.id)
    if (error) setErr(error.message); else void load()
  }

  const withItems = posts.filter(p => items.some(i => i.post_id === p.id))
  const open = withItems.filter(p => items.some(i => i.post_id === p.id && i.status === 'pending'))
  const done = withItems.filter(p => !open.includes(p))

  return (
    <div className="screen">
      <div className="row" style={{ marginBottom: 4 }}>
        <h2 className="title grow" style={{ marginBottom: 0 }}>Promises</h2>
        <Link to="/new" className="btn small" style={{ textDecoration: 'none' }}>New post</Link>
      </div>
      <p className="sub">Your open posts. Tick things off as you go.</p>
      {err && <div className="err">{err}</div>}
      {open.length === 0 && <p className="muted">Nothing open. Tap + to make a post with promises in it.</p>}
      {open.map(p => <PostCard key={p.id} p={p} items={items.filter(i => i.post_id === p.id)} onToggle={toggle} onAdd={addItem} onDelete={remove} />)}
      {done.length > 0 && (
        <>
          <button className="link" onClick={() => setShowDone(s => !s)}>{showDone ? 'Hide' : 'Show'} completed ({done.length})</button>
          {showDone && done.map(p => <PostCard key={p.id} p={p} items={items.filter(i => i.post_id === p.id)} onToggle={toggle} onAdd={addItem} onDelete={remove} />)}
        </>
      )}
    </div>
  )
}

function PostCard({ p, items, onToggle, onAdd, onDelete }: {
  p: Post; items: Promise_[]
  onToggle: (i: Promise_) => void; onAdd: (postId: string, text: string) => void; onDelete: (p: Post) => void
}) {
  const [text, setText] = useState('')
  const done = items.filter(i => i.status === 'fulfilled').length
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 10 }}>
        <div className="grow">
          <div>{p.caption || 'Promises'}</div>
          <div className="muted">{ago(p.created_at)} · {done}/{items.length} done · {timeLeft(p.feed_expires_at)}</div>
        </div>
        <button className="link muted" onClick={() => onDelete(p)}>Delete</button>
      </div>
      <div style={{ height: 4, background: 'var(--s2)', borderRadius: 4, marginBottom: 12 }}>
        <div style={{ width: items.length ? `${(done / items.length) * 100}%` : 0, height: '100%', background: 'var(--green)', borderRadius: 4 }} />
      </div>
      {items.map(i => (
        <div key={i.id} className="row" style={{ marginBottom: 10 }}>
          <button className={'tick' + (i.status === 'fulfilled' ? ' done' : '')} onClick={() => onToggle(i)} aria-label="Toggle done">✓</button>
          <div className="grow" style={{ textDecoration: i.status === 'fulfilled' ? 'line-through' : 'none', color: i.status === 'fulfilled' ? 'var(--mute)' : 'inherit' }}>{i.text}</div>
        </div>
      ))}
      <form className="row" onSubmit={e => { e.preventDefault(); if (text.trim()) { onAdd(p.id, text.trim()); setText('') } }}>
        <input className="input" style={{ marginBottom: 0 }} placeholder="Add another…" maxLength={140} value={text} onChange={e => setText(e.target.value)} />
        <button className="btn small ghost">Add</button>
      </form>
    </div>
  )
}
