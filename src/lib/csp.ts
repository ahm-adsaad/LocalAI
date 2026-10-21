/**
 * Content-Security-Policy for the app. One constant, sent by the Vite preview
 * server and by the production host (public/_headers must match; a unit test
 * checks). The point is enforceable privacy: even if a dependency tried to
 * phone home with document text, the browser would refuse the connection.
 */

/** The only remote hosts the page may open a connection to: model weights. */
export const MODEL_HOSTS = [
  // WebLLM and Transformers.js weights; resolve/ URLs redirect to *.hf.co CDNs.
  'https://huggingface.co',
  'https://*.hf.co',
  // WebLLM's per-model WebAssembly runtime libraries.
  'https://raw.githubusercontent.com',
]

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  // No inline or third-party JavaScript. 'wasm-unsafe-eval' lets WebLLM and
  // ONNX Runtime compile the WebAssembly they fetch; eval() stays forbidden.
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  `connect-src 'self' ${MODEL_HOSTS.join(' ')}`,
  "img-src 'self' data: blob:",
  // Fonts and styles are bundled; 'unsafe-inline' covers React style props.
  "style-src 'self' 'unsafe-inline'",
  // Vite inlines font subsets under 4 KB as data: URIs; they are static bytes, not a channel.
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')
