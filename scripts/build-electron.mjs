import { build } from 'esbuild'
import { existsSync, mkdirSync } from 'fs'

const ensureDir = (dir) => { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }) }

// Embed default API keys at build time so the app works out-of-the-box.
// Set these secrets in Replit (or as env vars locally) before building.
const defined = {
  'process.env.NODE_ENV': '"production"',
}

const keyMappings = {
  DEFAULT_GROQ_KEY:   'process.env.DEFAULT_GROQ_KEY',
  DEFAULT_OPENAI_KEY: 'process.env.DEFAULT_OPENAI_KEY',
  DEFAULT_GOOGLE_KEY: 'process.env.DEFAULT_GOOGLE_KEY',
}

for (const [envVar, defineKey] of Object.entries(keyMappings)) {
  const val = process.env[envVar] || ''
  defined[defineKey] = JSON.stringify(val)
  if (val) {
    console.log(`🔑 ${envVar}: ✅ will be embedded`)
  } else {
    console.log(`🔑 ${envVar}: (not set — users will see onboarding)`)
  }
}

const sharedConfig = {
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  external: ['electron'],
  define: defined,
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
