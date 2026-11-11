import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase, type Post, type Profile as P } from '../lib/supabase'
import { POST_COLS, loadBundles, type Bundle } from '../lib/posts'
import { useAuth } from '../lib/auth'
import PostCard from '../components/PostCard'

export default function Profile() {
  const { username } = useParams()
  const { session } = useAuth()
  const me = session!.user.id
  const [person, setPerson] = useState<P | null | undefined>(undefined)
  const [rows, setRows] = useState<Bundle[]>([])

  const load = useCallback(async () => {
    const { data: p } = await supabase.from('profiles').select('id,username,display_name,avatar_path,timezone')
      .eq('username', (username ?? '').toLowerCase()).maybeSingle()
    setPerson((p as P) ?? null)
    if (!p) return
    const { data: pins } = await supabase.from('post_pins').select('post_id,position').eq('user_id', (p as P).id).order('position')
    const ids = ((pins as { post_id: string }[]) ?? []).map(x => x.post_id)
    if (ids.length === 0) return setRows([])
    const { data: posts } = await supabase.from('posts').select(POST_COLS).in('id', ids)
    const order = new Map(ids.map((id, i) => [id, i]))
    const list = ((posts as Post[]) ?? []).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    setRows(await loadBundles(list, me))
  }, [username, me])
  useEffect(() => { void load() }, [load])

  if (person === undefined) return <div className="screen"><p className="muted">Loading…</p></div>
  if (person === null) {
    return (
      <div className="screen">
        <p className="sub">This profile isn't available.</p>
        <Link to="/friends" className="link">Back to friends</Link>
      </div>
    )
  }
  return (
    <div className="screen">
      <Link to="/friends" className="link" style={{ textDecoration: 'none' }}>← Back</Link>
      <div className="row" style={{ margin: '12px 0 18px' }}>
        <div className="avatar" style={{ width: 56, height: 56, fontSize: 22 }}>{person.display_name[0]?.toUpperCase()}</div>
        <div><h2 className="title" style={{ marginBottom: 0 }}>{person.display_name}</h2><div className="muted">@{person.username}</div></div>
      </div>
      <h3 style={{ margin: '0 0 10px' }}>Pinned</h3>
      {rows.length === 0 && <p className="muted">Nothing pinned yet.</p>}
      {rows.map(b => <PostCard key={b.post.id} b={b} me={me} onChanged={load} />)}
    </div>
  )
}
