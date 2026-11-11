import { useCallback, useEffect, useState } from 'react'
import { supabase, type Promise_, type PromiseList } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { todayLocal, ago } from '../lib/time'

export default function Promises() {
  const { session } = useAuth()
  const uid = session!.user.id
  const [lists, setLists] = useState<PromiseList[]>([])
  const [items, setItems] = useState<Promise_[]>([])
  const [caption, setCaption] = useState('')
  const [draft, setDraft] = useState<string[]>([])
  const [draftText, setDraftText] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data: ls } = await supabase.from('promise_lists')
      .select('id,user_id,caption,local_date,created_at,feed_expires_at,archived_at')
      .eq('user_id', uid).order('created_at', { ascending: false })
    const { data: ps } = await supabase.from('promises')
      .select('id,list_id,user_id,position,text,status,fulfilled_at').eq('user_id', uid).order('position')
    setLists((ls as PromiseList[]) ?? [])
    setItems((ps as Promise_[]) ?? [])
  }, [uid])
  useEffect(() => { void load() }, [load])

  function addDraft(e?: React.FormEvent) {
    e?.preventDefault()
    const t = draftText.trim()
    if (!t) return
    setDraft(d => [...d, t]); setDraftText('')
  }

  async function postList() {
    setErr('')
    const pending = draftText.trim() ? [...draft, draftText.trim()] : draft
    if (pending.length === 0) return setErr('Add at least one promise.')
    setBusy(true)
    const { data: list, error } = await supabase.from('promise_lists')
      .insert({ user_id: uid, caption: caption.trim() || null, local_date: todayLocal() }).select('id').single()
    if (error || !list) { setBusy(false); return setErr(error?.message ?? 'Could not create list') }
    const rows = pending.map((text, i) => ({ user_id: uid, list_id: list.id, local_date: todayLocal(), position: i + 1, text }))
    const { error: e2 } = await supabase.from('promises').insert(rows)
    setBusy(false)
    if (e2) return setErr(e2.message)
    setCaption(''); setDraft([]); setDraftText(''); void load()
  }

  async function toggle(p: Promise_) {
    const { error } = await supabase.rpc('set_promise_status', { p_id: p.id, p_fulfilled: p.status !== 'fulfilled' })
    if (error) setErr(error.message); else void load()
  }
  async function addItem(listId: string, text: string) {
    const count = items.filter(i => i.list_id === listId).length
    const { error } = await supabase.from('promises').insert({ user_id: uid, list_id: listId, local_date: todayLocal(), position: count + 1, text })
    if (error) setErr(error.message); else void load()
  }
  async function archive(l: PromiseList) {
    const { error } = await supabase.from('promise_lists').update({ archived_at: l.archived_at ? null : new Date().toISOString() }).eq('id', l.id)
    if (error) setErr(error.message); else void load()
  }
  async function remove(l: PromiseList) {
    if (!confirm('Delete this list and its promises?')) return
    const { error } = await supabase.from('promise_lists').delete().eq('id', l.id)
    if (error) setErr(error.message); else void load()
  }

  const active = lists.filter(l => !l.archived_at)
  const archived = lists.filter(l => l.archived_at)

  return (
    <div className="screen">
      <h2 className="title">Promises</h2>
      <p className="sub">Group what you're committing to in a list. Friends see it for 24 hours and can watch you tick things off.</p>

      <div className="card">
        <input className="input" placeholder="What's this list about? (optional)" maxLength={280} value={caption} onChange={e => setCaption(e.target.value)} />
        {draft.map((t, i) => (
          <div key={i} className="row" style={{ marginBottom: 8 }}>
            <span className="tick" style={{ cursor: 'default' }} />
            <div className="grow">{t}</div>
            <button className="link muted" onClick={() => setDraft(d => d.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        <form onSubmit={addDraft} className="row">
          <input className="input" style={{ marginBottom: 0 }} placeholder="I promise to…" maxLength={140} value={draftText} onChange={e => setDraftText(e.target.value)} />
          <button type="submit" className="btn small ghost">Add</button>
        </form>
        <button className="btn" style={{ marginTop: 12 }} disabled={busy} onClick={postList}>Post list</button>
        {err && <div className="err">{err}</div>}
      </div>

      {active.length === 0 && <p className="muted">No active lists yet.</p>}
      {active.map(l => <ListCard key={l.id} l={l} items={items.filter(i => i.list_id === l.id)} onToggle={toggle} onAdd={addItem} onArchive={archive} onDelete={remove} />)}

      {archived.length > 0 && (
        <>
          <button className="link" onClick={() => setShowArchived(s => !s)}>{showArchived ? 'Hide' : 'Show'} archived ({archived.length})</button>
          {showArchived && archived.map(l => <ListCard key={l.id} l={l} items={items.filter(i => i.list_id === l.id)} onToggle={toggle} onAdd={addItem} onArchive={archive} onDelete={remove} />)}
        </>
      )}
    </div>
  )
}

function ListCard({ l, items, onToggle, onAdd, onArchive, onDelete }: {
  l: PromiseList; items: Promise_[]
  onToggle: (p: Promise_) => void; onAdd: (listId: string, text: string) => void
  onArchive: (l: PromiseList) => void; onDelete: (l: PromiseList) => void
}) {
  const [text, setText] = useState('')
  const done = items.filter(i => i.status === 'fulfilled').length
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 10 }}>
        <div className="grow">
          <div>{l.caption || 'Promise list'}</div>
          <div className="muted">{ago(l.created_at)} · {done}/{items.length} done</div>
        </div>
        <button className="link muted" onClick={() => onArchive(l)}>{l.archived_at ? 'Restore' : 'Archive'}</button>
        <button className="link muted" onClick={() => onDelete(l)}>Delete</button>
      </div>
      <div style={{ height: 4, background: 'var(--s2)', borderRadius: 4, marginBottom: 12 }}>
        <div style={{ width: items.length ? `${(done / items.length) * 100}%` : 0, height: '100%', background: 'var(--green)', borderRadius: 4 }} />
      </div>
      {items.map(p => (
        <div key={p.id} className="row" style={{ marginBottom: 10 }}>
          <button className={'tick' + (p.status === 'fulfilled' ? ' done' : '')} onClick={() => onToggle(p)} aria-label="Toggle done">✓</button>
          <div className="grow" style={{ textDecoration: p.status === 'fulfilled' ? 'line-through' : 'none', color: p.status === 'fulfilled' ? 'var(--mute)' : 'inherit' }}>{p.text}</div>
        </div>
      ))}
      {!l.archived_at && (
        <form className="row" onSubmit={e => { e.preventDefault(); if (text.trim()) { onAdd(l.id, text.trim()); setText('') } }}>
          <input className="input" style={{ marginBottom: 0 }} placeholder="Add another…" maxLength={140} value={text} onChange={e => setText(e.target.value)} />
          <button className="btn small ghost">Add</button>
        </form>
      )}
    </div>
  )
}
