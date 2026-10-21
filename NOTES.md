# LocalAI — on-device decisions

Short log of non-obvious inference-layer choices. Update when those choices change.

## Why a Web Worker

Model load, embedding forward passes, reranking, and token generation are multi-second
GPU/CPU jobs. If they ran on the main thread, React could not paint progress bars or
accept input. The worker owns WebLLM (`MLCEngine`), both Transformers.js models, and the
dense index; the UI only speaks a typed `postMessage` protocol via `WorkerClient`.

We host `MLCEngine` *inside* our own worker instead of using `CreateWebWorkerMLCEngine`
from the main thread, so embeddings, reranking and generation share one worker and one
message surface.

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
row — switching reloads weights in the worker with no server involved. `?model=qwen-fast`
pins the boot model (the e2e audit uses it).

## Embeddings

**Model:** `Xenova/all-MiniLM-L6-v2` via `@huggingface/transformers` `feature-extraction`,
`dtype: 'q8'`, mean-pool + L2 normalize.

Run on **WASM in the worker**, not WebGPU, so we do not contend with the LLM for
VRAM. Vectors are persisted in IndexedDB with chunk text so a refresh skips re-embed.

**Why still MiniLM.** `npm run eval:models` compared eight ONNX embedders on the golden
set (eval/results/models.md). Once BM25 is fused in, the best small model moves hybrid
MRR by 0.011 and the only clearly stronger dense model (bge-base) is five times larger.
Switching would also invalidate every stored vector. Not worth it; revisit when the
corpus or the questions change character.

**Batching.** The worker embeds in batches of 8, sorted by text length first
(`batching.ts`), so a heading does not get padded out to a paragraph's token count.
Results are mapped back to the caller's order; progress events drive the "Embedding
12/22" status.

## Vector search

Hybrid retrieval in the browser — no external vector DB:

1. **Dense:** dot product over an in-worker `Float32Array` index (`vectorIndex.ts`).
   The main thread packs the active chat's vectors once per library change and
   transfers the buffer; a query message carries only the text. Before this, every
   query serialised every vector through `postMessage`: at 10k chunks that was
   ~390 ms per question (structured clone + scoring, Node) versus ~22 ms now, and the
   index is 15 MB instead of boxed JS arrays.
2. **Sparse:** Okapi BM25 over chunk text on the main thread (exact names / codes).
3. **Fuse:** Reciprocal Rank Fusion (RRF).
4. **Rerank:** the top 8 fused candidates go through `Xenova/ms-marco-MiniLM-L-6-v2`
   (cross-encoder, q8, WASM) and the head is re-sorted by its logits; the tail keeps
   fused order (`rerank.ts`). On the golden set this lifts hit@1 88.9% → 93.3% and MRR
   0.933 → 0.959, and verbatim follow-ups from 75% → 100% in the top 3. Five rerankers
   were compared: the two-layer TinyBERT is *worse* than no reranker; L-6 wins on every
   embedder. If the reranker fails to load (offline first run), fused order stands.
5. **Select:** the only post-step defers number-soup chunks behind prose ones (top hit
   always kept).
6. **Clip:** each excerpt is cut to 360 chars for prefill. Two signals pick what
   survives: the lexical window (the boundary-aligned span holding the most
   rarity-weighted question terms; the cut never lands before a matched term) and
   the semantic anchor (`focus.ts`: the cross-encoder scores each *sentence* of a
   chunk that needs clipping; windows were too diluted to score). If the anchored
   sentence already sits in the window, that is the excerpt; if not, the excerpt
   is the window plus that one sentence (capped at 160 chars), in document order.
   Head-clipping delivered the fact for 46.7% of golden questions, the lexical
   window for 97.8%, both signals for 100%, at 281 → 296 mean chars. Neither
   signal alone reaches 100%: the lexical window loses "Lisinopril … for
   hypertension" to the literal "blood pressure" line, the cross-encoder loses
   "$21.3 million in cash" to a revenue sentence it likes better, and no fixed
   blend satisfies both. Sentence splitting treats a PDF line break as a boundary
   only after punctuation or a heading-sized line, and never after "Dr." and co.

Fine for thousands of chunks; revisit only if library size becomes the bottleneck.
`npm run eval:retrieval` reports hit@k / MRR per stage; the in-app `?bench` panel runs
the whole pipeline on the real GPU and grades answers.

**Reranker device.** `RERANKER_DEVICE` (`types.ts`) can put the cross-encoder on
WebGPU in fp16. We measured both on the dev machine: Intel Iris Xe integrated,
Qwen 2.5 1.5B, the same three questions in the same order, with the first one
paying any warm-up.

| Question | WebGPU rerank | WebGPU focus | WASM rerank | WASM focus |
| --- | --- | --- | --- | --- |
| Jordan Lee's allergy (first) | 4881 ms | 286 ms | 734 ms | 364 ms |
| Monthly rent | 212 ms | 806 ms | 772 ms | 758 ms |
| Northwind's cash | 199 ms | 846 ms | 761 ms | 440 ms |

Once warm, WebGPU runs the 8-pair rerank about 3.7× faster. It loses the focus
pass, though: about 28 short sentence pairs, where per-dispatch overhead outweighs
the math. Across the whole cross-encoder stage that nets only ~20%, and it costs a
~4.9 s shader compile on the first question plus GPU memory next to the LLM.
**WASM ships.**

Trying WebGPU needs no extra runtime files. Transformers.js imports
`onnxruntime-web/webgpu`, and in ONNX Runtime 1.26 that entry runs the WebGPU
execution provider from the asyncify build already served under `/ort/`. The JSEP
build fails there with `webgpuInit is not a function`.

Before it opens a WebGPU session, the worker checks four things: the browser is not
Safari (its plain build has no WebGPU provider), `navigator.gpu` exists, an adapter
is available, and the adapter has `shader-f16`. If any check fails, the worker
falls back to q8 on WASM with one warning, and the console names the device it
landed on (`[localai] reranker: wasm`). One failure cannot be recovered from:
Transformers.js chains every session create through one promise, which stays
rejected after a failure. So a failure inside the WebGPU session create also
breaks the WASM fallback, and fused order stands.

The WebGPU path stays behind the constant for discrete GPUs and for two changes
that could flip the result: warming the shaders at boot with a dummy pair, and
making the focus pass fewer, longer pairs.

## Pages

`extractPdfText` returns one string per page; `chunkPages` produces exactly the chunks
`chunkText(pages.join('\n\n'))` would (a test enforces it, so retrieval numbers did
not move) and tags each with the 1-based page range it spans. The prompt labels
excerpts `[1] lease.pdf (p. 2)`, citation chips carry the title "lease.pdf, p. 2",
source cards show the page, and the Markdown export includes it. Chunks indexed before
this change have no page fields; everything degrades to the filename.

## Follow-ups and extraction

- **Condense before retrieve.** If the question leans on prior turns (pronoun,
  "what about", ≤5 words) and there is an assistant turn to lean on, we ask the
  model for a one-line standalone rewrite (max 48 tokens, temp 0) and retrieve
  with that. Self-contained questions skip the extra generation. Earlier *user*
  questions (not answers) are carried into the RAG prompt, because a 1.5B model
  shown its own "The fact is not there." repeats it.
- **`/extract a, b, c`** retrieves with the field names, then generates under a
  JSON-schema grammar (`response_format: json_object` + schema → XGrammar), so a
  1.5B model returns parseable `{field: {value, source}}` every time. Values are
  rendered as a table with the excerpt each one came from.
- **Citations.** The prompt asks for `[n]` after each fact; the UI rewrites those
  into links that open the matching source card.

## Stopping

The stop button posts `abort`; the worker calls `engine.interruptGenerate()`, which
ends decoding at the next step and closes the completion stream. The worker then
reports `aborted` with the partial text and stats, the client resolves (not rejects),
and the turn is persisted with `aborted: true`. The old implementation only stopped
*forwarding* tokens while the GPU kept decoding to `max_tokens`.

## Observability

Every turn stores `TurnStats`: TTFT, decode tok/s, prefill tok/s, prompt and
completion tokens (from WebLLM `usage.extra`, with wall-clock fallbacks), plus
retrieval, rerank and rewrite latency measured on the main thread. Shown under each
answer and persisted with the chat.

**Overview queries** ("what's this about?"): MiniLM cosine often returns weak
mid-doc metric/UI scraps (~0.15–0.25). We detect those intents, expand the
*embedding* query toward "summary/intro" (BM25 still uses the raw question),
and pin the first chunks of each PDF into the prompt so the model sees
titles/headings instead of click-tracking noise. Prompt text also forbids
"document not provided" refusals — excerpts ARE the document.

## Speed (browser WebGPU reality)

Bottleneck is usually **prefill** (reading a long RAG prompt) then **decode**
(token-by-token). Fixes we apply:

- Trim excerpts (360 chars) and keep top-k small (3–4) so the prompt stays short.
- Cap `max_tokens` at 180 so answers stop sooner.
- Reload the LLM with `context_window_size: 2048` for a smaller KV cache.
- Batch UI token paints with `requestAnimationFrame` (React was re-rendering per token).
- Search `postMessage` sends the query only; vectors live in the worker.
- The reranker is one WASM forward pass over 8 pairs; it is the one retrieval stage
  with visible cost (hundreds of ms on a laptop CPU), which is why the pool is 8 and
  not 24.

Still not ChatGPT-fast: a 1–3B Q4 model on a laptop GPU is typically a few–tens of
tokens/sec. A tinier model (e.g. SmolLM2-360M) would be snappier but weaker at RAG.

PDF dashboards often extract as number soup; we rebuild lines from glyph positions,
prefer prose-dense chunks, and prompt the model to paraphrase metrics — not echo
raw tables. Re-upload a PDF after changing extraction to refresh IndexedDB chunks.

## Weight caching / offline path

1. **First visit:** browser downloads LLM weights (WebLLM Cache API), the embedding
   and reranker ONNX files (Transformers.js browser cache), and ONNX Runtime's
   WebAssembly from *this origin* (`/ort/`, copied from `onnxruntime-web` at build
   time). Document text never leaves the device.
2. **Later visits / offline:** weights load from cache; IndexedDB restores documents
   and embeddings; RAG and chat work with zero network if caches are intact.
3. **COOP/COEP (`credentialless`):** enables cross-origin isolation /
   `SharedArrayBuffer` for WASM while still allowing Hugging Face weight downloads.

## Privacy hard line

No backend for inference, embeddings, or document text. If client-side generation
fails, the UI surfaces the error — it must never silently call a remote LLM API.

Enforced, not asserted: the Content-Security-Policy (`src/lib/csp.ts`, mirrored in
`public/_headers`, checked equal by a unit test) allows connections only to this
origin and the model-weight hosts, and only first-party scripts (`'wasm-unsafe-eval'`
for the WebAssembly runtimes). Fonts are bundled from `@fontsource`, so no font CDN.
`npm run test:e2e` drives the production build in Chrome on the real GPU and asserts
that the whole session made no request to another host, none with a body, none
containing document text, and triggered no CSP report. CI runs the header/boot half.
