import { useCallback, useEffect, useState } from 'react'
import { supabase, type Friendship, type Profile } from '../lib/supabase'
import { useAuth } from '../lib/auth'

type Row = { f: Friendship; other: Profile }

export default function Friends() {
  const { session } = useAuth()
  const uid = session!.user.id
  const [rows, setRows] = useState<Row[]>([])
  const [username, setUsername] = useState('')
  const [msg, setMsg] = useState('')
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

  async function add(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setMsg('')
    const { error } = await supabase.rpc('send_friend_request', { p_username: username.trim().replace(/^@/, '') })
    if (error) return setErr(error.message)
    setUsername(''); setMsg("Request sent (or accepted if they'd already asked you)."); void load()
  }
  async function respond(id: string, accept: boolean) {
    const { error } = await supabase.rpc('respond_friend_request', { p_id: id, p_accept: accept })
    if (error) setErr(error.message); else void load()
  }
  async function block(other: string) {
    if (!confirm('Block this user? They will no longer see your posts.')) return
    const { error } = await supabase.from('blocks').insert({ blocker_id: uid, blocked_id: other })
    if (error) setErr(error.message); else void load()
  }

  const incoming = rows.filter(r => r.f.status === 'pending' && r.f.requested_by !== uid)
  const outgoing = rows.filter(r => r.f.status === 'pending' && r.f.requested_by === uid)
  const friends = rows.filter(r => r.f.status === 'accepted')

  const Person = ({ p, children }: { p: Profile; children?: React.ReactNode }) => (
    <div className="card row">
      <div className="avatar">{p.display_name[0]?.toUpperCase()}</div>
      <div className="grow"><div>{p.display_name}</div><div className="muted">@{p.username}</div></div>
      {children}
    </div>
  )

  return (
    <div className="screen">
      <h2 className="title">Friends</h2>
      <p className="sub">Add people by username. Only friends see your posts.</p>
      <form onSubmit={add} className="row">
        <input className="input" style={{ marginBottom: 0 }} placeholder="@username" value={username} onChange={e => setUsername(e.target.value)} required />
        <button className="btn small">Add</button>
      </form>
      {err && <div className="err">{err}</div>}
      {msg && <div className="ok">{msg}</div>}

      {incoming.length > 0 && <h3 style={{ margin: '22px 0 10px' }}>Requests</h3>}
      {incoming.map(r => (
        <Person key={r.f.id} p={r.other}>
          <button className="btn small" onClick={() => respond(r.f.id, true)}>Accept</button>
          <button className="btn small ghost" onClick={() => respond(r.f.id, false)}>Decline</button>
        </Person>
      ))}
      {outgoing.length > 0 && <h3 style={{ margin: '22px 0 10px' }}>Sent</h3>}
      {outgoing.map(r => <Person key={r.f.id} p={r.other}><span className="chip">Pending</span></Person>)}

      <h3 style={{ margin: '22px 0 10px' }}>Your friends ({friends.length})</h3>
      {friends.length === 0 && <p className="muted">No friends yet. Share your username so they can add you.</p>}
      {friends.map(r => (
        <Person key={r.f.id} p={r.other}>
          <button className="link muted" onClick={() => block(r.other.id)}>Block</button>
        </Person>
      ))}
    </div>
  )
}
