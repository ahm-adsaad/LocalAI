import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { CONTENT_SECURITY_POLICY } from './src/lib/csp.ts'

/**
 * COOP/COEP headers enable cross-origin isolation so SharedArrayBuffer is
 * available. WebLLM's WASM runtime can use it for faster multi-threaded math.
 * `credentialless` (vs require-corp) still isolates the page but allows
 * cross-origin model weight downloads from Hugging Face without CORP headers.
 *
 * The CSP is the enforceable half of the privacy promise: the browser refuses
 * any connection that is not to this origin or a model-weight host. Production
 * sends the same string from public/_headers (a unit test keeps them equal).
 */
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
}

/** Dev needs Vite's inline React-refresh preamble and its HMR websocket. */
const devCsp = CONTENT_SECURITY_POLICY.replace(
  "script-src 'self' 'wasm-unsafe-eval'",
  "script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline'",
).replace("connect-src 'self'", "connect-src 'self' ws://localhost:* ws://127.0.0.1:*")

/**
 * Transformers.js loads ONNX Runtime's WebAssembly from a public CDN unless
 * told otherwise. Serving the exact files from our own origin (dev middleware
 * and build assets under /ort/) keeps every byte of executable code
 * first-party, so the CSP never needs a third-party script host.
 */
const ORT_DIST = fileURLToPath(new URL('./node_modules/onnxruntime-web/dist/', import.meta.url))
const ORT_FILES = [
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
  // Safari gets the non-asyncify build (mirrors Transformers.js's own choice).
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
]

function ortWasm(): Plugin {
  return {
    name: 'localai-ort-wasm',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.startsWith('/ort/') ? req.url.slice(5).split('?')[0] : undefined
        if (!name || !ORT_FILES.includes(name)) return next()
        res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript')
        res.end(readFileSync(`${ORT_DIST}${name}`))
      })
    },
    generateBundle() {
      for (const name of ORT_FILES) {
        this.emitFile({ type: 'asset', fileName: `ort/${name}`, source: readFileSync(`${ORT_DIST}${name}`) })
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), ortWasm()],
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // Keep these out of Vite's prebundle — they ship their own WASM/workers.
    exclude: ['@mlc-ai/web-llm', '@huggingface/transformers'],
  },
  server: {
    headers: { ...crossOriginIsolation, 'Content-Security-Policy': devCsp },
  },
  preview: {
    headers: { ...crossOriginIsolation, 'Content-Security-Policy': CONTENT_SECURITY_POLICY },
  },
})
