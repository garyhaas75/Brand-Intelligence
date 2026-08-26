import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { attachToken, auth, Login } from './auth.jsx'

// The app used to sit behind the browser's basic-auth popup. Now it sits behind a login screen
// and a whp-auth token. The gate lives here rather than inside App so App and its fetch calls
// did not have to change: attachToken adds the header to every /api request, and a 401 from
// anywhere drops back to the login screen instead of leaving the app half-working.
//
// Attach BEFORE the first render, not from an effect inside Gate. React runs a child's effects
// before its parent's, so an effect here fired after App had already mounted and sent its first
// /api/brands. That request went out with no Authorization header, came back 401, and the
// dashboard rendered "No brands tracked yet" while still holding a perfectly good session.
//
// Share links (/share/:token) never reach this bundle: the server answers those directly,
// before the gate, so a shared report still opens for someone with no account.
attachToken(() => {
  // attachToken has already cleared the token, so a reload lands on the login screen. A reload
  // rather than a state flip because this runs outside React and can fire before Gate mounts.
  window.location.reload()
})

function Gate() {
  const [signedIn, setSignedIn] = useState(() => !!auth.get())
  if (!signedIn) return <Login onDone={() => setSignedIn(true)} />
  return <App />
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Gate />
  </StrictMode>,
)
