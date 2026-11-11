import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { todayLocal } from '../lib/time'

export default function NewPost() {
  const nav = useNavigate()
  const [caption, setCaption] = useState('')
  const [items, setItems] = useState<string[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  function add(e?: React.FormEvent) {
    e?.preventDefault()
    const t = text.trim()
    if (t) { setItems(i => [...i, t]); setText('') }
  }

  async function post(record = false) {
    setErr('')
    const all = text.trim() ? [...items, text.trim()] : items
    if (all.length === 0 && !caption.trim()) return setErr('Add a promise or a caption first.')
    setBusy(true)
    const { data, error } = await supabase.rpc('create_post', {
      p_caption: caption, p_items: all, p_local_date: todayLocal(),
      p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    })
    setBusy(false)
    if (error) return setErr(error.message)
    nav(record && data ? `/session?post=${data as string}` : '/promises')
  }

  return (
    <div className="screen">
      <h2 className="title">New post</h2>
      <p className="sub">Say what you're going to do. Friends see it right away. Record a timelapse against it now or later.</p>
      <div className="card">
        <input className="input" placeholder="What's this about? (optional)" maxLength={280} value={caption} onChange={e => setCaption(e.target.value)} />
        {items.map((t, i) => (
          <div key={i} className="row" style={{ marginBottom: 8 }}>
            <span className="tick" style={{ cursor: 'default' }} />
            <div className="grow">{t}</div>
            <button className="link muted" onClick={() => setItems(x => x.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        <form onSubmit={add} className="row">
          <input className="input" style={{ marginBottom: 0 }} placeholder="I promise to…" maxLength={140} value={text} onChange={e => setText(e.target.value)} />
          <button type="submit" className="btn small ghost">Add</button>
        </form>
        {err && <div className="err">{err}</div>}
        <button className="btn" style={{ marginTop: 12 }} disabled={busy} onClick={() => post(true)}>Post &amp; start recording</button>
        <button className="btn ghost" style={{ marginTop: 10 }} disabled={busy} onClick={() => post(false)}>Post now, record later</button>
      </div>
    </div>
  )
}
