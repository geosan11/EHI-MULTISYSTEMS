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
          background_color: '#070b14',
          theme_color: '#0B0F19',
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
          navigateFallbackDenylist: [/^\/api\//]
        }
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
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
