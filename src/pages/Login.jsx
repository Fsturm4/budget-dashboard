import { useState } from 'react'
import { supabase } from '../lib/supabase.js'

export default function Login() {
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [signingIn, setSigningIn] = useState(false)
  const [error,    setError]    = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setSigningIn(true)
    setError(null)
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setSigningIn(false)
    if (signInError) setError(signInError.message)
  }

  return (
    <main className="main-content">
      <div className="page upload-page">
        <h1>Sign in</h1>
        <form onSubmit={handleSubmit}>
          <label className="upload-label">
            Email
            <input className="upload-select" type="email" autoComplete="username" required
                   value={email} onChange={e => setEmail(e.target.value)} />
          </label>
          <label className="upload-label">
            Password
            <input className="upload-select" type="password" autoComplete="current-password" required
                   value={password} onChange={e => setPassword(e.target.value)} />
          </label>
          {error && <p className="upload-error">{error}</p>}
          <button className="upload-confirm-btn" type="submit" disabled={signingIn}>
            {signingIn ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  )
}
