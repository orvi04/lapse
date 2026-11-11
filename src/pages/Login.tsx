import { useState } from 'react'
import { supabase } from '../lib/supabase'
import PasswordInput from '../components/PasswordInput'

const MIN_LEN = 8

export default function Login() {
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  function switchMode() {
    setMode(m => (m === 'in' ? 'up' : 'in'))
    setErr(''); setInfo(''); setPassword(''); setConfirm('')
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(''); setInfo('')

    if (mode === 'up') {
      // Rules are shown only when creating a password, never when signing in.
      if (password.length < MIN_LEN) return setErr(`Use at least ${MIN_LEN} characters for your password.`)
      if (password !== confirm) return setErr("The passwords don't match.")
    }

    setBusy(true)
    const res = mode === 'up'
      ? await supabase.auth.signUp({ email: email.trim(), password })
      : await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)

    if (res.error) {
      const status = (res.error as { status?: number }).status
      const network = !status || status >= 500
      if (mode === 'in') {
        // One message for every sign-in failure so it can't be used to learn anything about an account.
        return setErr(network ? 'Something went wrong. Please try again.' : 'Incorrect email or password.')
      }
      return setErr(network ? 'Something went wrong. Please try again.' : "We couldn't create that account. If you already have one, sign in instead.")
    }
    if (mode === 'up' && !res.data.session) setInfo('Check your email to confirm your account, then sign in.')
  }

  async function google() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + window.location.pathname },
    })
    if (error) setErr('Google sign-in is not available right now.')
  }

  return (
    <div className="screen hero">
      <h1>Lapse</h1>
      <p className="sub">Make promises. Show up. Post the timelapse.</p>
      <form onSubmit={submit}>
        <input className="input" type="email" placeholder="Email" aria-label="Email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required />
        <PasswordInput
          label="Password" placeholder="Password" value={password} onChange={setPassword}
          autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
        />
        {mode === 'up' && (
          <>
            <PasswordInput label="Confirm password" placeholder="Confirm password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
            <p className="muted" style={{ marginTop: -2 }}>At least {MIN_LEN} characters.</p>
          </>
        )}
        {err && <div className="err" role="alert">{err}</div>}
        {info && <div className="ok">{info}</div>}
        <button className="btn" disabled={busy}>{mode === 'up' ? 'Create account' : 'Sign in'}</button>
      </form>
      <button className="btn ghost" style={{ marginTop: 10 }} onClick={google}>Continue with Google</button>
      <p className="muted" style={{ textAlign: 'center', marginTop: 16 }}>
        {mode === 'up' ? 'Already have an account?' : 'New here?'}{' '}
        <button className="link" onClick={switchMode}>{mode === 'up' ? 'Sign in' : 'Create account'}</button>
      </p>
      <p className="muted" style={{ textAlign: 'center' }}>18+ only.</p>
    </div>
  )
}
