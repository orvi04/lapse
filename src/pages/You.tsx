import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { fmtFocus, todayLocal } from '../lib/time'

type Day = { local_date: string; post_count: number; focus_seconds: number }

export default function You() {
  const { profile } = useAuth()
  const [days, setDays] = useState<Day[]>([])

  useEffect(() => {
    const to = todayLocal()
    const from = new Date(Date.now() - 27 * 864e5).toISOString().slice(0, 10)
    supabase.rpc('activity_by_day', { p_from: from, p_to: to }).then(({ data }) => setDays((data as Day[]) ?? []))
  }, [])

  const byDate = new Map(days.map(d => [d.local_date, d]))
  const cells = Array.from({ length: 28 }, (_, i) => {
    const d = new Date(Date.now() - (27 - i) * 864e5).toISOString().slice(0, 10)
    return { d, v: byDate.get(d)?.focus_seconds ?? 0 }
  })
  const max = Math.max(1, ...cells.map(c => c.v))
  const total = days.reduce((a, d) => a + d.focus_seconds, 0)
  const posts = days.reduce((a, d) => a + d.post_count, 0)

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
      <button className="btn ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
      <p className="muted" style={{ textAlign: 'center', marginTop: 16 }}>Version {__BUILD__.slice(0, 16).replace('T', ' ')}</p>
    </div>
  )
}
