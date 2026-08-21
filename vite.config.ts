import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * COOP/COEP headers enable cross-origin isolation so SharedArrayBuffer is
 * available. WebLLM's WASM runtime can use it for faster multi-threaded math.
 * `credentialless` (vs require-corp) still isolates the page but allows
 * cross-origin model weight downloads from Hugging Face without CORP headers.
 */
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // Keep these out of Vite's prebundle — they ship their own WASM/workers.
    exclude: ['@mlc-ai/web-llm', '@huggingface/transformers'],
  },
  server: {
    headers: crossOriginIsolation,
  },
  preview: {
    headers: crossOriginIsolation,
  },
})
