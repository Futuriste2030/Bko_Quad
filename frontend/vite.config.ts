import { VitePWA } from 'vite-plugin-pwa';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // HTTPS en dev : la caméra et les notifications exigent une origine
    // sécurisée (sur téléphone via IP locale, sinon refus d'office).
    basicSsl(),
    VitePWA({
      registerType: 'autoUpdate',
      // Jamais de SW en dev : le cache applicatif ne concerne que la prod.
      devOptions: { enabled: false },
      workbox: {
        cleanupOutdatedCaches: true,
        // Police auto-hébergée disponible hors ligne (guide §11).
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff,woff2}'],
        // L'API ne passe jamais par le cache du service worker.
        navigateFallbackDenylist: [/^\/api\//, /\.apk$/],
      },
      manifest: {
        name: 'BKO Quad Hub',
        short_name: 'BKO Hub',
        lang: 'fr',
        display: 'standalone',
        theme_color: '#0a0a0a',
        background_color: '#ffffff',
        start_url: '.',
        icons: [
          { src: 'android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  server: {
    host: true,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      // Médias Django via la même origine : pas de contenu mixte en HTTPS,
      // images (cachet, signature) visibles aussi sur téléphone.
      '/media': 'http://127.0.0.1:8000',
    },
  },
});
