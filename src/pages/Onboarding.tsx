import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

export default function Onboarding() {
  const { refreshProfile } = useAuth()
  const [username, setUsername] = useState('')
  const [name, setName] = useState('')
  const [dob, setDob] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(''); setBusy(true)
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    const { error } = await supabase.rpc('create_profile', {
      p_username: username.trim().toLowerCase(),
      p_display_name: name.trim(),
      p_timezone: tz,
      p_birth_date: dob,
    })
    setBusy(false)
    if (error) return setErr(error.message)
    await refreshProfile()
  }

  return (
    <div className="screen hero">
      <h2 className="title">Set up your profile</h2>
      <p className="sub">Friends find you by username. Lapse is for people 18 and over; we check your age once and don't store your date of birth.</p>
      <form onSubmit={submit}>
        <input className="input" placeholder="Username (3–20: a–z, 0–9, _)" pattern="[a-z0-9_]{3,20}" value={username} onChange={e => setUsername(e.target.value.toLowerCase())} required />
        <input className="input" placeholder="Display name" maxLength={40} value={name} onChange={e => setName(e.target.value)} required />
        <label className="muted">Date of birth</label>
        <input className="input" type="date" value={dob} max={new Date().toISOString().slice(0, 10)} onChange={e => setDob(e.target.value)} required />
        {err && <div className="err">{err}</div>}
        <button className="btn" disabled={busy}>Continue</button>
      </form>
      <button className="link" style={{ marginTop: 14 }} onClick={() => supabase.auth.signOut()}>Sign out</button>
    </div>
  )
}
