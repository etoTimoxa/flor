import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

async function dropOldServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
  try {
    if (sessionStorage.getItem('flor-drop-sw') === '1') return
    const registrations = await navigator.serviceWorker.getRegistrations()
    if (!registrations.length) return
    sessionStorage.setItem('flor-drop-sw', '1')
    await Promise.all(registrations.map((registration) => registration.unregister()))
    const keys = await caches.keys()
    await Promise.all(keys.map((key) => caches.delete(key)))
    window.location.reload()
  } catch {
    // Continue without the old cache.
  }
}

function withTimeout(task: Promise<void>, ms: number) {
  return Promise.race([
    task,
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, ms)
    }),
  ])
}

void withTimeout(dropOldServiceWorker(), 2500).then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
