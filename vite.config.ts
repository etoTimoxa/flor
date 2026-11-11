import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['floorball-icon.svg', 'apple-touch-icon.png', 'haikei-bg.svg', 'horn.mp3'],
      manifest: {
        name: 'Флор',
        short_name: 'Флор',
        description: 'Флорбол кафедры: составы, матчи и голы',
        theme_color: '#0d3a4a',
        background_color: '#0d3a4a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './#/',
        icons: [
          {
            src: 'pwa-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^https:\/\/s3\.regru\.cloud\//i],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,mp3}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/s3\.regru\.cloud\//i,
            handler: 'NetworkOnly',
          },
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'faculty-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
})
