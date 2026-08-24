// Sign-in against whp-auth, plus the plumbing that makes the rest of this app work unchanged.
//
// This app used to sit behind the browser's basic-auth popup, so its 67 fetch calls never had
// to think about credentials. Rather than touch all 67, `attachToken` wraps window.fetch once
// and adds the Authorization header to same-origin /api requests. Every existing call keeps
// working, and a 401 anywhere clears the session and returns to the login screen.
import { useEffect, useState } from 'react'

const KEY = 'brand_intel_token'

export const auth = {
  get: () => localStorage.getItem(KEY) || '',
  set: (t) => localStorage.setItem(KEY, t),
  clear: () => localStorage.removeItem(KEY),
}

let attached = false
export function attachToken(onUnauthorized) {
  if (attached) return
  attached = true
  const real = window.fetch.bind(window)
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : (input && input.url) || ''
    const isOurApi = url.startsWith('/api') || url.startsWith(window.location.origin + '/api')
    if (isOurApi) {
      const token = auth.get()
      if (token) {
        const headers = new Headers((init && init.headers) || (input && input.headers) || {})
        headers.set('Authorization', 'Bearer ' + token)
        init = { ...init, headers }
      }
    }
    const res = await real(input, init)
    // A session that has been ended, revoked or expired. Do not leave the app half-usable.
    if (isOurApi && res.status === 401) {
      auth.clear()
      if (onUnauthorized) onUnauthorized()
    }
    return res
  }
}

export function Login({ onDone }) {
  const [cfg, setCfg] = useState(null)
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [code, setCode] = useState('')
  // Stay on the code step once it has been asked for, even if the code is wrong. Otherwise a
  // typo sends people back to retyping their password.
  const [needCode, setNeedCode] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(setCfg).catch(() => setCfg({}))
  }, [])

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      if (!cfg || !cfg.whp_auth_url) throw new Error('This service has no WHP_AUTH_URL set, so sign-in cannot be attempted.')
      const res = await fetch(cfg.whp_auth_url + '/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(), password: pw, app: cfg.app,
          ...(needCode && code.trim() ? { code: code.trim() } : {}),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (data.mfa_setup_required && data.setup_url) { window.location.href = data.setup_url; return }
      // A temp or expired password. whp-auth refuses the session and hands back a
      // one-time link to set a real one, the same shape as the two-factor handoff
      // above. Without this the person is told to open a link that is not on screen.
      if (data.password_change_required && data.change_url) { window.location.href = data.change_url; return }
      if (data.mfa_required) { setNeedCode(true); setCode(''); setErr(''); return }
      if (!res.ok || !data.token) throw new Error(data.detail || 'Sign in failed')
      auth.set(data.token)
      onDone()
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Sign in failed')
    } finally {
      setBusy(false)
    }
  }

  const field = {
    width: '100%', padding: '11px 12px', borderRadius: 8, border: '1px solid #d1d5db',
    fontSize: 15, boxSizing: 'border-box', marginBottom: 12,
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f6f7f9' }}>
      <form onSubmit={submit} style={{ background: '#fff', borderRadius: 12, padding: 36, width: 360, boxShadow: '0 4px 24px rgba(0,0,0,.08)' }}>
        <h1 style={{ margin: '0 0 6px', fontSize: 21 }}>Brand Intelligence</h1>
        <p style={{ margin: '0 0 22px', color: '#6b7280', fontSize: 14 }}>
          {needCode
            ? 'Password accepted. Enter the 6-digit code from your authenticator app.'
            : 'Sign in with your WHP account.'}
        </p>
        <input type="email" placeholder="Email" autoComplete="username" value={email}
               disabled={needCode} autoFocus={!needCode} style={field}
               onChange={e => setEmail(e.target.value)} />
        <input type="password" placeholder="Password" autoComplete="current-password" value={pw}
               disabled={needCode} style={field} onChange={e => setPw(e.target.value)} />
        {needCode && (
          <input type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code"
                 value={code} autoFocus style={field} onChange={e => setCode(e.target.value)} />
        )}
        {err && <p style={{ color: '#b91c1c', fontSize: 13, margin: '0 0 12px' }}>{err}</p>}
        <button type="submit" disabled={busy || !email.trim() || !pw || (needCode && !code.trim())}
                style={{ width: '100%', padding: 11, borderRadius: 8, border: 'none', background: '#111827',
                         color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
          {busy ? 'Signing in…' : needCode ? 'Verify and sign in' : 'Sign in'}
        </button>
        {needCode && (
          <button type="button" onClick={() => { setNeedCode(false); setCode(''); setErr('') }}
                  style={{ width: '100%', marginTop: 8, background: 'none', border: 'none', color: '#6b7280',
                           fontSize: 13, textDecoration: 'underline', cursor: 'pointer' }}>
            Start over
          </button>
        )}
      </form>
    </div>
  )
}
