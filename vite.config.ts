import { defineConfig } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: 'main/index.ts',
        vite: {
          build: {
            outDir: 'dist-electron/main',
          },
        },
      },
      preload: {
        input: path.join(__dirname, 'preload/index.ts'),
        vite: {
          build: {
            outDir: 'dist-electron/preload',
          },
        },
      },
      renderer: {},
    }),
  ],
})
