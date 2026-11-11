import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, type Friendship, type Profile } from '../lib/supabase'
import { useAuth } from '../lib/auth'

type Row = { f: Friendship; other: Profile }
type Hit = { id: string; username: string; display_name: string; relation: 'none' | 'friends' | 'sent' | 'received' }

export default function Friends() {
  const { session } = useAuth()
  const uid = session!.user.id
  const [rows, setRows] = useState<Row[]>([])
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    const { data: fs } = await supabase.from('friendships').select('id,user_low,user_high,requested_by,status')
    const list = (fs as Friendship[]) ?? []
    const ids = list.map(f => (f.user_low === uid ? f.user_high : f.user_low))
    const { data: ps } = ids.length
      ? await supabase.from('profiles').select('id,username,display_name,avatar_path,timezone').in('id', ids)
      : { data: [] as Profile[] }
    const byId = new Map(((ps as Profile[]) ?? []).map(p => [p.id, p]))
    setRows(list.flatMap(f => {
      const other = byId.get(f.user_low === uid ? f.user_high : f.user_low)
      return other ? [{ f, other }] : []
    }))
  }, [uid])
  useEffect(() => { void load() }, [load])

  async function search(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    const term = q.trim().replace(/^@/, '')
    if (term.length < 3) { setHits(null); return setErr('Type at least 3 characters.') }
    setSearching(true)
    const { data, error } = await supabase.rpc('search_profiles', { p_query: term })
    setSearching(false)
    if (error) return setErr(error.message)
    setHits((data as Hit[]) ?? [])
  }
  async function request(h: Hit) {
    setErr('')
    const { error } = await supabase.rpc('send_friend_request', { p_username: h.username })
    if (error) return setErr(error.message)
    setHits(list => list?.map(x => (x.id === h.id ? { ...x, relation: x.relation === 'received' ? 'friends' : 'sent' } : x)) ?? null)
    void load()
  }
  async function respond(id: string, accept: boolean) {
    const { error } = await supabase.rpc('respond_friend_request', { p_id: id, p_accept: accept })
    if (error) setErr(error.message); else void load()
  }
  async function unfriendOrCancel(f: Friendship) {
    const { error } = await supabase.from('friendships').delete().eq('id', f.id)
    if (error) setErr(error.message); else void load()
  }
  async function block(other: string) {
    if (!confirm('Block this user? They will no longer see your posts.')) return
    const { error } = await supabase.from('blocks').insert({ blocker_id: uid, blocked_id: other })
    if (error) setErr(error.message); else { void load(); setHits(null) }
  }

  const incoming = rows.filter(r => r.f.status === 'pending' && r.f.requested_by !== uid)
  const outgoing = rows.filter(r => r.f.status === 'pending' && r.f.requested_by === uid)
  const friends = rows.filter(r => r.f.status === 'accepted')

  const Person = ({ name, username, link, children }: { name: string; username: string; link?: boolean; children?: React.ReactNode }) => (
    <div className="card row">
      <div className="avatar">{name[0]?.toUpperCase()}</div>
      <div className="grow">
        <div>{link ? <Link to={`/u/${username}`} style={{ color: 'inherit', textDecoration: 'none' }}>{name}</Link> : name}</div>
        <div className="muted">@{username}</div>
      </div>
      {children}
    </div>
  )

  return (
    <div className="screen">
      <h2 className="title">Friends</h2>
      <p className="sub">Search by username or name, then send a request. Only friends see your posts.</p>
      <form onSubmit={search} className="row">
        <input className="input" style={{ marginBottom: 0 }} placeholder="Search people" value={q} onChange={e => setQ(e.target.value)} />
        <button className="btn small" disabled={searching}>{searching ? '…' : 'Search'}</button>
      </form>
      {err && <div className="err">{err}</div>}

      {hits && (
        <div style={{ marginTop: 14 }}>
          {hits.length === 0 && <p className="muted">No one found for "{q.trim()}".</p>}
          {hits.map(h => (
            <Person key={h.id} name={h.display_name} username={h.username}>
              {h.relation === 'none' && <button className="btn small" onClick={() => request(h)}>Request</button>}
              {h.relation === 'sent' && <span className="chip">Requested</span>}
              {h.relation === 'received' && <button className="btn small" onClick={() => request(h)}>Accept</button>}
              {h.relation === 'friends' && <span className="chip green">Friends</span>}
            </Person>
          ))}
        </div>
      )}

      {incoming.length > 0 && <h3 style={{ margin: '22px 0 10px' }}>Requests</h3>}
      {incoming.map(r => (
        <Person key={r.f.id} name={r.other.display_name} username={r.other.username}>
          <button className="btn small" onClick={() => respond(r.f.id, true)}>Accept</button>
          <button className="btn small ghost" onClick={() => respond(r.f.id, false)}>Decline</button>
        </Person>
      ))}
      {outgoing.length > 0 && <h3 style={{ margin: '22px 0 10px' }}>Sent</h3>}
      {outgoing.map(r => (
        <Person key={r.f.id} name={r.other.display_name} username={r.other.username}>
          <span className="chip">Pending</span>
          <button className="link muted" onClick={() => unfriendOrCancel(r.f)}>Cancel</button>
        </Person>
      ))}

      <h3 style={{ margin: '22px 0 10px' }}>Your friends ({friends.length})</h3>
      {friends.length === 0 && <p className="muted">No friends yet. Search for someone above.</p>}
      {friends.map(r => (
        <Person key={r.f.id} name={r.other.display_name} username={r.other.username} link>
          <button className="link muted" onClick={() => unfriendOrCancel(r.f)}>Remove</button>
          <button className="link muted" onClick={() => block(r.other.id)}>Block</button>
        </Person>
      ))}
    </div>
  )
}
