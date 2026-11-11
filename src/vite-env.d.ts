/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_SYNC_URL?: string
  readonly VITEST?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
