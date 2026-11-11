import React from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import { AuthProvider } from './lib/auth'
import App from './App'
import './styles.css'

registerSW({ immediate: true })

// If a newer build is live, drop the old cached copy once and reload.
async function checkVersion() {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' })
    const { build } = (await r.json()) as { build: string }
    const key = 'reloaded-for-' + build
    if (build !== __BUILD__ && !sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, '1')
      const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? []
      await Promise.all(regs.map(x => x.unregister()))
      for (const k of await caches.keys()) await caches.delete(k)
      location.reload()
    }
  } catch { /* offline: keep running the cached copy */ }
}
void checkVersion()
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void checkVersion() })

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </HashRouter>
  </React.StrictMode>,
)
