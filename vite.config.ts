import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['apple-touch-icon.png'],
        manifest: {
          name: 'EHI Multisystems',
          short_name: 'EHI Ops',
          description: 'EHI Multisystems Logistics Intelligence Platform — cargo, ValueJet excess baggage, and marketing operations.',
          start_url: '/',
          display: 'standalone',
          // Matches the app's default (dark) theme -- these are static and
          // can't react to a user's later in-app dark-mode toggle, so they're
          // set to whatever the majority of first launches will actually see
          // (src/lib/useTheme.ts defaults to 'dark'), avoiding a light/dark
          // flash on the OS-level PWA splash for the common case.
          // Value == --color-canvas (dark) in src/index.css / #splash in index.html.
          background_color: '#0f1117',
          theme_color: '#0f1117',
          icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
          ]
        },
        workbox: {
          // App-shell precaching only. Do NOT cache API/Supabase requests here —
          // Dexie's sync queue already owns data offline-support; overlapping
          // caching strategies for the same requests would fight each other.
          globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
          navigateFallbackDenylist: [/^\/api\//],
          // Workbox's default cap is 2 MiB -- the main app-shell chunk has
          // grown past that (2.1 MB as of this change) as views/features were
          // added, and generateSW() *fails the whole build* (not just a
          // warning) for any precached asset over the limit. Raised with
          // headroom for continued growth rather than excluding the app
          // shell from precaching, since offline-first is a core part of
          // this app's design (see the Dexie sync queue this comment already
          // references) -- the app shell is exactly what needs to be
          // available offline, not something to drop from the cache.
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts',
                expiration: {
                  maxEntries: 30,
                  maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/cdn-uicons\.flaticon\.com\/.*/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'flaticon-icons',
                expiration: {
                  maxEntries: 20,
                  maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        }
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    define: {
      // @react-pdf/renderer references Node's `global` -- resolve it to the
      // browser's globalThis (paired with the Buffer polyfill in main.tsx).
      global: 'globalThis',
      // Surfaced in Settings.tsx as a version footer -- read from
      // package.json at build time so the two never drift apart.
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    build: {
      target: 'es2020',
      minify: 'esbuild' as const,
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor':  ['react', 'react-dom', 'react-router-dom'],
            'ui-vendor':     ['lucide-react', 'motion'],
            'charts':        ['recharts'],
            'virtual':       ['@tanstack/react-virtual'],
            'supabase':      ['@supabase/supabase-js'],
            'pdf':           ['@react-pdf/renderer'],
            'qr':            ['html5-qrcode'],
            'offline':       ['dexie'],
          },
        },
      },
      chunkSizeWarningLimit: 600,
    },
  };
});
