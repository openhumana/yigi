import { build } from 'esbuild'
import { existsSync, mkdirSync } from 'fs'

const ensureDir = (dir) => { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }) }

const sharedConfig = {
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  external: [
    'electron',
  ],
  define: { 'process.env.NODE_ENV': '"production"' },
  minify: false,
  sourcemap: false,
}

ensureDir('dist-electron/main')
ensureDir('dist-electron/preload')

console.log('⚙️  Compiling Electron main process...')
await build({
  ...sharedConfig,
  entryPoints: ['main/index.ts'],
  outfile: 'dist-electron/main/index.js',
})

console.log('⚙️  Compiling Electron preload bridge...')
await build({
  ...sharedConfig,
  entryPoints: ['preload/index.ts'],
  outfile: 'dist-electron/preload/index.js',
})

console.log('✅ Electron compilation complete')
