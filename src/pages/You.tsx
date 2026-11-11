import { useCallback, useEffect, useState } from 'react'
import { supabase, type Post } from '../lib/supabase'
import { POST_COLS, loadBundles, type Bundle } from '../lib/posts'
import { useAuth } from '../lib/auth'
import { fmtFocus, todayLocal } from '../lib/time'
import PostCard from '../components/PostCard'

type Day = { local_date: string; post_count: number; focus_seconds: number }
const PAGE = 15

export default function You() {
  const { session, profile } = useAuth()
  const me = session!.user.id
  const [days, setDays] = useState<Day[]>([])
  const [rows, setRows] = useState<Bundle[]>([])
  const [more, setMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  useEffect(() => {
    const to = todayLocal()
    const from = new Date(Date.now() - 27 * 864e5).toISOString().slice(0, 10)
    supabase.rpc('activity_by_day', { p_from: from, p_to: to }).then(({ data }) => setDays((data as Day[]) ?? []))
  }, [])

  const load = useCallback(async (count: number) => {
    const { data, error } = await supabase.from('posts').select(POST_COLS)
      .eq('author_id', me).order('created_at', { ascending: false }).range(0, count)
    if (error) { setErr(error.message); setLoading(false); return }
    const list = (data as Post[]) ?? []
    setMore(list.length > count)
    setRows(await loadBundles(list.slice(0, count), me))
    setLoading(false)
  }, [me])
  const [count, setCount] = useState(PAGE)
  useEffect(() => { void load(count) }, [load, count])

  const byDate = new Map(days.map(d => [d.local_date, d]))
  const cells = Array.from({ length: 28 }, (_, i) => {
    const d = new Date(Date.now() - (27 - i) * 864e5).toISOString().slice(0, 10)
    return { d, v: byDate.get(d)?.focus_seconds ?? 0 }
  })
  const max = Math.max(1, ...cells.map(c => c.v))
  const total = days.reduce((a, d) => a + d.focus_seconds, 0)
  const posts = days.reduce((a, d) => a + d.post_count, 0)
  const pinned = rows.filter(r => r.pinned)
  const rest = rows.filter(r => !r.pinned)

  return (
    <div className="screen">
      <div className="row" style={{ marginBottom: 18 }}>
        <div className="avatar" style={{ width: 56, height: 56, fontSize: 22 }}>{profile!.display_name[0]?.toUpperCase()}</div>
        <div><h2 className="title" style={{ marginBottom: 0 }}>{profile!.display_name}</h2><div className="muted">@{profile!.username}</div></div>
      </div>
      <div className="card">
        <div className="stats" style={{ marginTop: 0 }}>
          <div className="stat"><b>{fmtFocus(total)}</b><span className="muted">last 28 days</span></div>
          <div className="stat"><b>{posts}</b><span className="muted">posts</span></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(14,1fr)', gap: 4, marginTop: 14 }}>
          {cells.map(c => (
            <div key={c.d} title={c.d} style={{ aspectRatio: '1', borderRadius: 4, background: c.v ? `rgba(61,220,151,${0.25 + 0.75 * c.v / max})` : 'var(--s2)' }} />
          ))}
        </div>
      </div>

      {pinned.length > 0 && <h3 style={{ margin: '20px 0 10px' }}>Pinned</h3>}
      {pinned.map(b => <PostCard key={b.post.id} b={b} me={me} onChanged={() => load(count)} owner />)}

      <h3 style={{ margin: '20px 0 4px' }}>Your archive</h3>
      <p className="sub">Everything you've posted, kept privately. Pin up to 3 to show friends on your profile.</p>
      {loading && <p className="muted">Loading…</p>}
      {err && <div className="err">{err}</div>}
      {!loading && rows.length === 0 && <p className="muted">Nothing yet.</p>}
      {rest.map(b => <PostCard key={b.post.id} b={b} me={me} onChanged={() => load(count)} owner />)}
      {more && <button className="btn ghost" onClick={() => setCount(c => c + PAGE)}>Show more</button>}

      <button className="btn ghost" style={{ marginTop: 16 }} onClick={() => supabase.auth.signOut()}>Sign out</button>
      <p className="muted" style={{ textAlign: 'center', marginTop: 16 }}>Version {__BUILD__.slice(0, 16).replace('T', ' ')}</p>
    </div>
  )
}
