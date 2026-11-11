import { useCallback, useEffect, useState } from 'react'
import { supabase, type Post } from '../lib/supabase'
import { POST_COLS, loadBundles, type Bundle } from '../lib/posts'
import { useAuth } from '../lib/auth'
import PostCard from '../components/PostCard'

export default function Feed() {
  const { session } = useAuth()
  const me = session!.user.id
  const [rows, setRows] = useState<Bundle[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('posts').select(POST_COLS)
      .gt('feed_expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(50)
    if (error) { setErr(error.message); setLoading(false); return }
    setRows(await loadBundles((data as Post[]) ?? [], me))
    setLoading(false)
  }, [me])
  useEffect(() => { void load() }, [load])

  return (
    <div className="screen">
      <h2 className="title">Today</h2>
      <p className="sub">Posts from you and your friends. They leave the feed after 24 hours.</p>
      {loading && <p className="muted">Loading…</p>}
      {err && <div className="err">{err}</div>}
      {!loading && !err && rows.length === 0 && <p className="muted">Nothing here yet. Tap + to post, or add friends.</p>}
      {rows.map(b => <PostCard key={b.post.id} b={b} me={me} onChanged={load} owner={b.post.author_id === me} />)}
    </div>
  )
}
