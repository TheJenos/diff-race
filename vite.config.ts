import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  // wasm(): Rapier's browser build imports its .wasm as an ES module (src/game/physics.ts)
  plugins: [react(), wasm()],
  // Pre-bundling would inline that .wasm as base64; served as a file, dev loads it like production
  optimizeDeps: { exclude: ['@dimforge/rapier3d'] },
  // The track generator runs in a module worker (src/game/track/worker.ts)
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    // three.js alone is ~640 kB minified; it can't be split further.
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        // Libraries in their own files: they change far less often than the game, so returning
        // players keep them cached across deploys.
        codeSplitting: {
          groups: [
            // Not the loaders: the glTF one is fetched only when there are kit models (game/models.ts).
            { name: 'three', test: /node_modules[\\/]three[\\/](?!examples[\\/]jsm[\\/]loaders[\\/])/ },
            { name: 'firebase', test: /node_modules[\\/](@?firebase)[\\/]/ },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
          ],
        },
      },
    },
  },
});
