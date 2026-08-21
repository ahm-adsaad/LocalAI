# LocalAI

Local-first confidential document workspace. Drop in PDFs, ask questions — retrieval,
embeddings, and generation all run in your browser on WebGPU. No server, no API keys,
no document content leaves the device.

## Requirements

- Chrome 113+ / Edge 113+ (or another browser with WebGPU)
- Hardware GPU acceleration enabled

## Quick start

```bash
npm install
npm run dev
```

Open the printed localhost URL. First load downloads the LLM and embedding weights
(one-time). After that, the app works offline from browser cache + IndexedDB.

Try the included sample at `/sample-medical-summary.pdf` (or drop any text PDF), then ask
e.g. “What allergy does Jordan Lee have?” — you should see a streamed answer plus
expandable source chunks.

## Stack

| Piece | Choice |
| --- | --- |
| UI | Vite + React + TypeScript + Tailwind |
| LLM | `@mlc-ai/web-llm` — Qwen 2.5 / Phi-4 mini / Llama 3.2 (Q4f16), user-selectable |
| Default model | `Qwen2.5-1.5B-Instruct-q4f16_1-MLC` (VRAM-aware recommendation) |
| Embeddings | `@huggingface/transformers` — `Xenova/all-MiniLM-L6-v2` |
| PDF | `pdfjs-dist` |
| Persistence | IndexedDB via `idb` |

See [NOTES.md](./NOTES.md) for on-device design decisions and the full model matrix.

## Phases

0. WebGPU capability gate  
1. Streaming on-device chat (WebLLM in a worker)  
2. PDF → chunk → embed → IndexedDB  
3. RAG Q&A with visible source chunks  
4. Multi-document library + status UI  
