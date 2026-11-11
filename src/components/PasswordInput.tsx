import { useState } from 'react'

type Props = {
  value: string
  onChange: (v: string) => void
  placeholder: string
  autoComplete: 'new-password' | 'current-password'
  minLength?: number
  label: string
}

export default function PasswordInput({ value, onChange, placeholder, autoComplete, minLength, label }: Props) {
  const [show, setShow] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <input
        className="input"
        style={{ paddingRight: 64 }}
        type={show ? 'text' : 'password'}
        placeholder={placeholder}
        aria-label={label}
        autoComplete={autoComplete}
        minLength={minLength}
        value={value}
        onChange={e => onChange(e.target.value)}
        required
      />
      <button
        type="button"
        className="link"
        style={{ position: 'absolute', right: 6, top: 10, fontSize: 13 }}
        aria-label={show ? 'Hide password' : 'Show password'}
        onClick={() => setShow(s => !s)}
      >
        {show ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}
