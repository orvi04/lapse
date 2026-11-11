import { useCallback, useEffect, useState } from 'react'
import { supabase, type Promise_ } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { todayLocal } from '../lib/time'

export default function Promises() {
  const { session } = useAuth()
  const uid = session!.user.id
  const [items, setItems] = useState<Promise_[]>([])
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const today = todayLocal()

  const load = useCallback(async () => {
    const { data } = await supabase.from('promises').select('id,local_date,position,text,status,fulfilled_at,expires_on')
      .eq('user_id', uid).gte('expires_on', today).order('local_date', { ascending: false }).order('position')
    setItems((data as Promise_[]) ?? [])
  }, [uid, today])
  useEffect(() => { void load() }, [load])

  const todays = items.filter(i => i.local_date === today)
  const carried = items.filter(i => i.local_date !== today && i.status !== 'fulfilled')

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    const used = new Set(todays.map(t => t.position))
    const position = [1, 2, 3].find(p => !used.has(p))
    if (!position) return setErr('Max 3 promises a day.')
    const { error } = await supabase.from('promises').insert({ user_id: uid, local_date: today, position, text: text.trim() })
    if (error) return setErr(error.message)
    setText(''); void load()
  }

  async function toggle(p: Promise_) {
    const done = p.status === 'fulfilled'
    const { error } = await supabase.from('promises').update({
      status: done ? 'open' : 'fulfilled', fulfilled_at: done ? null : new Date().toISOString(),
    }).eq('id', p.id)
    if (error) setErr(error.message); else void load()
  }

  const Item = ({ p }: { p: Promise_ }) => (
    <div className="card row">
      <button className={'tick' + (p.status === 'fulfilled' ? ' done' : '')} onClick={() => toggle(p)} aria-label="Mark fulfilled">✓</button>
      <div className="grow" style={{ textDecoration: p.status === 'fulfilled' ? 'line-through' : 'none', color: p.status === 'fulfilled' ? 'var(--mute)' : 'inherit' }}>{p.text}</div>
    </div>
  )

  return (
    <div className="screen">
      <h2 className="title">Promises</h2>
      <p className="sub">Up to 3 for today. Unfinished ones carry over for 7 days.</p>
      {todays.map(p => <Item key={p.id} p={p} />)}
      {todays.length === 0 && <p className="muted">Nothing promised yet today.</p>}
      {todays.length < 3 && (
        <form onSubmit={add} className="row" style={{ marginTop: 10 }}>
          <input className="input" style={{ marginBottom: 0 }} placeholder="I promise to…" maxLength={140} value={text} onChange={e => setText(e.target.value)} required />
          <button className="btn small">Add</button>
        </form>
      )}
      {err && <div className="err">{err}</div>}
      {carried.length > 0 && (<>
        <h3 style={{ margin: '24px 0 10px' }}>Carried over</h3>
        {carried.map(p => <Item key={p.id} p={p} />)}
      </>)}
    </div>
  )
}
