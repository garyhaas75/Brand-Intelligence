import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { attachToken, auth, Login } from './auth.jsx'

// The app used to sit behind the browser's basic-auth popup. Now it sits behind a login screen
// and a whp-auth token. The gate lives here rather than inside App so App and its fetch calls
// did not have to change: attachToken adds the header to every /api request, and a 401 from
// anywhere drops back to the login screen instead of leaving the app half-working.
//
// Share links (/share/:token) never reach this bundle: the server answers those directly,
// before the gate, so a shared report still opens for someone with no account.
function Gate() {
  const [signedIn, setSignedIn] = useState(() => !!auth.get())
  useEffect(() => { attachToken(() => setSignedIn(false)) }, [])
  if (!signedIn) return <Login onDone={() => setSignedIn(true)} />
  return <App />
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Gate />
  </StrictMode>,
)
