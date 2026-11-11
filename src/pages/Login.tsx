import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [mode, setMode] = useState<'in' | 'up'>('up')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(''); setInfo(''); setBusy(true)
    const res = mode === 'up'
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (res.error) return setErr(res.error.message)
    if (mode === 'up' && !res.data.session) setInfo('Check your email to confirm, then sign in.')
  }

  async function google() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + window.location.pathname },
    })
    if (error) setErr(error.message)
  }

  return (
    <div className="screen hero">
      <h1>Lapse</h1>
      <p className="sub">Make promises. Show up. Post the timelapse.</p>
      <form onSubmit={submit}>
        <input className="input" type="email" placeholder="Email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required />
        <input className="input" type="password" placeholder="Password (8+ characters)" autoComplete={mode === 'up' ? 'new-password' : 'current-password'} minLength={8} value={password} onChange={e => setPassword(e.target.value)} required />
        {err && <div className="err">{err}</div>}
        {info && <div className="ok">{info}</div>}
        <button className="btn" disabled={busy}>{mode === 'up' ? 'Create account' : 'Sign in'}</button>
      </form>
      <button className="btn ghost" style={{ marginTop: 10 }} onClick={google}>Continue with Google</button>
      <p className="muted" style={{ textAlign: 'center', marginTop: 16 }}>
        {mode === 'up' ? 'Already have an account?' : 'New here?'}{' '}
        <button className="link" onClick={() => setMode(mode === 'up' ? 'in' : 'up')}>{mode === 'up' ? 'Sign in' : 'Create account'}</button>
      </p>
      <p className="muted" style={{ textAlign: 'center' }}>18+ only.</p>
    </div>
  )
}
