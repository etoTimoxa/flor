import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'

if (import.meta.env.PROD) {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      void updateSW(true)
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return
      void caches.keys().then((keys) => {
        keys
          .filter((key) => /s3|flor-sync/i.test(key))
          .forEach((key) => { void caches.delete(key) })
      })
      void registration.update()
      window.setInterval(() => { void registration.update() }, 15_000)
    },
  })
  navigator.serviceWorker?.addEventListener('controllerchange', () => {
    window.location.reload()
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
