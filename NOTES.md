# LocalAI — on-device decisions

Short log of non-obvious inference-layer choices. Update when those choices change.

## Why a Web Worker

Model load, embedding forward passes, and token generation are multi-second GPU/CPU
jobs. If they ran on the main thread, React could not paint progress bars or accept
input. The worker owns both WebLLM (`MLCEngine`) and Transformers.js; the UI only
speaks a typed `postMessage` protocol via `WorkerClient`.

We host `MLCEngine` *inside* our own worker instead of using `CreateWebWorkerMLCEngine`
from the main thread, so embeddings and generation share one worker and one message
surface.

## Why Q4 (and which models)

**Catalog** (all Q4f16, WebLLM prebuilt) — task matrix, not a single forced model:

| When you need… | Start with… |
| --- | --- |
| Highest on-device capability | Qwen 2.5 3B |
| Careful extraction / tight instructions | Phi-4 mini |
| Familiar Meta/Llama baseline | Llama 3.2 3B |
| Best everyday doc Q&A | Qwen 2.5 1.5B (default) |
| Max speed / low VRAM | Qwen 2.5 0.5B |

Qwen usually leads small-model RAG; Phi is the Microsoft edge-SLM story for precision;
Llama is industry-familiar. VRAM still recommends a default, but users can pick any
row — switching reloads weights in the worker with no server involved.

## Embeddings

**Model:** `Xenova/all-MiniLM-L6-v2` via `@huggingface/transformers` `feature-extraction`,
`dtype: 'q8'`, mean-pool + L2 normalize.

Run on **WASM in the worker**, not WebGPU, so we do not contend with the LLM for
VRAM. Vectors are persisted in IndexedDB with chunk text so a refresh skips re-embed.

## Vector search

Hybrid retrieval in the browser — no external vector DB:

1. **Dense:** brute-force cosine over MiniLM embeddings in the worker.
2. **Sparse:** Okapi BM25 over chunk text on the main thread (exact names / codes).
3. **Fuse:** Reciprocal Rank Fusion (RRF), then prose-density + overview pin logic.

Fine for hundreds/thousands of chunks; revisit only if library size becomes the
bottleneck.

**Overview queries** ("what's this about?"): MiniLM cosine often returns weak
mid-doc metric/UI scraps (~0.15–0.25). We detect those intents, expand the
*embedding* query toward "summary/intro" (BM25 still uses the raw question),
and pin the first chunks of each PDF into the prompt so the model sees
titles/headings instead of click-tracking noise. Prompt text also forbids
"document not provided" refusals — excerpts ARE the document.

## Speed (browser WebGPU reality)

Bottleneck is usually **prefill** (reading a long RAG prompt) then **decode**
(token-by-token). Fixes we apply:

- Trim excerpts (~280 chars) and keep top-k small (3–4) so the prompt stays short.
- Cap `max_tokens` at 160 so answers stop sooner.
- Reload the LLM with `context_window_size: 2048` for a smaller KV cache.
- Batch UI token paints with `requestAnimationFrame` (React was re-rendering per token).
- Search `postMessage` sends vectors only; text is joined back on the main thread.

Still not ChatGPT-fast: a 1B Q4 model on a laptop GPU is typically a few–tens of
tokens/sec. A tinier model (e.g. SmolLM2-360M) would be snappier but weaker at RAG.

PDF dashboards often extract as number soup; we rebuild lines from glyph positions,
prefer prose-dense chunks, and prompt the 1B model to paraphrase metrics — not echo
raw tables. Re-upload a PDF after changing extraction to refresh IndexedDB chunks.

## Weight caching / offline path

1. **First visit:** browser downloads LLM weights (WebLLM Cache API) and embedding
   ONNX files (Transformers.js browser cache). Document text never leaves the device.
2. **Later visits / offline:** weights load from cache; IndexedDB restores documents
   and embeddings; RAG and chat work with zero network if caches are intact.
3. **Vite COOP/COEP (`credentialless`):** enables cross-origin isolation /
   `SharedArrayBuffer` for WASM while still allowing Hugging Face weight downloads.

## Privacy hard line

No backend for inference, embeddings, or document text. If client-side generation
fails, the UI surfaces the error — it must never silently call a remote LLM API.
