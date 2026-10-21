# Embedder and reranker comparison

Golden set, single-turn questions (n=45) over 4 PDFs / 22 chunks. "excerpt" judges the top-3 excerpts after selection and query-focused clipping, i.e. what the model actually reads. Reranking re-scores the top 8 fused candidates with a cross-encoder. Timings are Node CPU (onnxruntime-node) and only indicative; the browser runs these on WASM.

## Embedders

| Embedder | q8 weights (MB) | embed ms/chunk (Node CPU) | dense hit@1 | dense hit@3 | dense MRR | hybrid hit@1 | hybrid hit@3 | hybrid MRR | excerpt hit@1 | excerpt hit@3 | excerpt MRR |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| (BM25 only, no embedder) | — | — | 88.9% | 95.6% | 0.927 | — | — | — | — | — | — |
| Xenova/all-MiniLM-L6-v2 | 23 | 36.8 | 82.2% | 93.3% | 0.886 | 88.9% | 100.0% | 0.933 | 88.9% | 97.8% | 0.926 |
| Xenova/bge-small-en-v1.5 | 34 | 42.6 | 77.8% | 93.3% | 0.862 | 84.4% | 97.8% | 0.908 | 84.4% | 95.6% | 0.896 |
| Xenova/gte-small | 34 | 39.3 | 77.8% | 95.6% | 0.874 | 88.9% | 97.8% | 0.930 | 88.9% | 95.6% | 0.919 |
| Snowflake/snowflake-arctic-embed-xs | 23 | 27.2 | 84.4% | 100.0% | 0.915 | 88.9% | 100.0% | 0.933 | 88.9% | 97.8% | 0.926 |
| mixedbread-ai/mxbai-embed-xsmall-v1 | 24 | 39.4 | 84.4% | 93.3% | 0.900 | 91.1% | 100.0% | 0.944 | 91.1% | 97.8% | 0.937 |
| Xenova/e5-small-v2 | 34 | 62.8 | 84.4% | 95.6% | 0.899 | 86.7% | 100.0% | 0.919 | 86.7% | 97.8% | 0.911 |
| nomic-ai/nomic-embed-text-v1.5 | 137 | 165.3 | 75.6% | 95.6% | 0.848 | 84.4% | 95.6% | 0.900 | 84.4% | 93.3% | 0.885 |
| Xenova/bge-base-en-v1.5 | 110 | 125.7 | 88.9% | 95.6% | 0.929 | 91.1% | 100.0% | 0.944 | 91.1% | 97.8% | 0.937 |

## Rerankers (on top of hybrid retrieval)

| Embedder | Reranker | q8 weights (MB) | rerank ms/query p50 (Node CPU, pool 8) | reranked hit@1 | reranked hit@3 | reranked MRR | excerpt hit@1 | excerpt hit@3 | excerpt MRR |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Xenova/all-MiniLM-L6-v2 | Xenova/ms-marco-TinyBERT-L-2-v2 | 4 | 72 | 86.7% | 100.0% | 0.926 | 86.7% | 97.8% | 0.919 |
| Xenova/all-MiniLM-L6-v2 | Xenova/ms-marco-MiniLM-L-4-v2 | 19 | 278 | 88.9% | 100.0% | 0.937 | 88.9% | 97.8% | 0.930 |
| Xenova/all-MiniLM-L6-v2 | Xenova/ms-marco-MiniLM-L-6-v2 | 23 | 262 | 93.3% | 100.0% | 0.959 | 93.3% | 97.8% | 0.952 |
| Xenova/all-MiniLM-L6-v2 | jinaai/jina-reranker-v1-tiny-en | 33 | 248 | 91.1% | 100.0% | 0.948 | 91.1% | 97.8% | 0.941 |
| Xenova/all-MiniLM-L6-v2 | mixedbread-ai/mxbai-rerank-xsmall-v1 | 87 | 801 | 91.1% | 97.8% | 0.950 | 91.1% | 95.6% | 0.933 |
| Xenova/bge-small-en-v1.5 | Xenova/ms-marco-TinyBERT-L-2-v2 | 4 | 59 | 86.7% | 100.0% | 0.926 | 86.7% | 97.8% | 0.919 |
| Xenova/bge-small-en-v1.5 | Xenova/ms-marco-MiniLM-L-4-v2 | 19 | 257 | 88.9% | 100.0% | 0.937 | 88.9% | 97.8% | 0.930 |
| Xenova/bge-small-en-v1.5 | Xenova/ms-marco-MiniLM-L-6-v2 | 23 | 250 | 93.3% | 100.0% | 0.959 | 93.3% | 97.8% | 0.952 |
| Xenova/bge-small-en-v1.5 | jinaai/jina-reranker-v1-tiny-en | 33 | 250 | 91.1% | 100.0% | 0.948 | 91.1% | 97.8% | 0.941 |
| Xenova/bge-small-en-v1.5 | mixedbread-ai/mxbai-rerank-xsmall-v1 | 87 | 729 | 93.3% | 97.8% | 0.957 | 93.3% | 95.6% | 0.944 |
| Xenova/gte-small | Xenova/ms-marco-TinyBERT-L-2-v2 | 4 | 62 | 86.7% | 100.0% | 0.926 | 86.7% | 97.8% | 0.919 |
| Xenova/gte-small | Xenova/ms-marco-MiniLM-L-4-v2 | 19 | 255 | 88.9% | 100.0% | 0.937 | 88.9% | 97.8% | 0.930 |
| Xenova/gte-small | Xenova/ms-marco-MiniLM-L-6-v2 | 23 | 247 | 93.3% | 100.0% | 0.959 | 93.3% | 97.8% | 0.952 |
| Xenova/gte-small | jinaai/jina-reranker-v1-tiny-en | 33 | 233 | 91.1% | 100.0% | 0.948 | 91.1% | 97.8% | 0.941 |
| Xenova/gte-small | mixedbread-ai/mxbai-rerank-xsmall-v1 | 87 | 669 | 93.3% | 97.8% | 0.957 | 93.3% | 95.6% | 0.944 |
| Snowflake/snowflake-arctic-embed-xs | Xenova/ms-marco-TinyBERT-L-2-v2 | 4 | 54 | 88.9% | 100.0% | 0.937 | 88.9% | 97.8% | 0.930 |
| Snowflake/snowflake-arctic-embed-xs | Xenova/ms-marco-MiniLM-L-4-v2 | 19 | 253 | 88.9% | 100.0% | 0.937 | 88.9% | 97.8% | 0.930 |
| Snowflake/snowflake-arctic-embed-xs | Xenova/ms-marco-MiniLM-L-6-v2 | 23 | 230 | 93.3% | 100.0% | 0.959 | 93.3% | 97.8% | 0.952 |
| Snowflake/snowflake-arctic-embed-xs | jinaai/jina-reranker-v1-tiny-en | 33 | 238 | 91.1% | 100.0% | 0.948 | 91.1% | 97.8% | 0.941 |
| Snowflake/snowflake-arctic-embed-xs | mixedbread-ai/mxbai-rerank-xsmall-v1 | 87 | 660 | 91.1% | 97.8% | 0.950 | 91.1% | 95.6% | 0.933 |
| mixedbread-ai/mxbai-embed-xsmall-v1 | Xenova/ms-marco-TinyBERT-L-2-v2 | 4 | 71 | 86.7% | 100.0% | 0.926 | 86.7% | 97.8% | 0.919 |
| mixedbread-ai/mxbai-embed-xsmall-v1 | Xenova/ms-marco-MiniLM-L-4-v2 | 19 | 277 | 88.9% | 100.0% | 0.937 | 88.9% | 97.8% | 0.930 |
| mixedbread-ai/mxbai-embed-xsmall-v1 | Xenova/ms-marco-MiniLM-L-6-v2 | 23 | 263 | 93.3% | 100.0% | 0.959 | 93.3% | 97.8% | 0.952 |
| mixedbread-ai/mxbai-embed-xsmall-v1 | jinaai/jina-reranker-v1-tiny-en | 33 | 271 | 91.1% | 100.0% | 0.948 | 91.1% | 97.8% | 0.941 |
| mixedbread-ai/mxbai-embed-xsmall-v1 | mixedbread-ai/mxbai-rerank-xsmall-v1 | 87 | 848 | 91.1% | 97.8% | 0.946 | 91.1% | 95.6% | 0.933 |
| Xenova/e5-small-v2 | Xenova/ms-marco-TinyBERT-L-2-v2 | 4 | 70 | 88.9% | 100.0% | 0.937 | 88.9% | 97.8% | 0.930 |
| Xenova/e5-small-v2 | Xenova/ms-marco-MiniLM-L-4-v2 | 19 | 306 | 88.9% | 100.0% | 0.937 | 88.9% | 97.8% | 0.930 |
| Xenova/e5-small-v2 | Xenova/ms-marco-MiniLM-L-6-v2 | 23 | 290 | 93.3% | 100.0% | 0.959 | 93.3% | 97.8% | 0.952 |
| Xenova/e5-small-v2 | jinaai/jina-reranker-v1-tiny-en | 33 | 272 | 91.1% | 100.0% | 0.948 | 91.1% | 97.8% | 0.941 |
| Xenova/e5-small-v2 | mixedbread-ai/mxbai-rerank-xsmall-v1 | 87 | 885 | 93.3% | 97.8% | 0.961 | 93.3% | 95.6% | 0.944 |
| nomic-ai/nomic-embed-text-v1.5 | Xenova/ms-marco-TinyBERT-L-2-v2 | 4 | 67 | 86.7% | 100.0% | 0.926 | 86.7% | 97.8% | 0.919 |
| nomic-ai/nomic-embed-text-v1.5 | Xenova/ms-marco-MiniLM-L-4-v2 | 19 | 274 | 88.9% | 100.0% | 0.937 | 88.9% | 97.8% | 0.930 |
| nomic-ai/nomic-embed-text-v1.5 | Xenova/ms-marco-MiniLM-L-6-v2 | 23 | 248 | 93.3% | 100.0% | 0.959 | 93.3% | 97.8% | 0.952 |
| nomic-ai/nomic-embed-text-v1.5 | jinaai/jina-reranker-v1-tiny-en | 33 | 239 | 91.1% | 100.0% | 0.948 | 91.1% | 97.8% | 0.941 |
| nomic-ai/nomic-embed-text-v1.5 | mixedbread-ai/mxbai-rerank-xsmall-v1 | 87 | 792 | 93.3% | 97.8% | 0.957 | 93.3% | 95.6% | 0.944 |
| Xenova/bge-base-en-v1.5 | Xenova/ms-marco-TinyBERT-L-2-v2 | 4 | 77 | 88.9% | 100.0% | 0.937 | 88.9% | 97.8% | 0.930 |
| Xenova/bge-base-en-v1.5 | Xenova/ms-marco-MiniLM-L-4-v2 | 19 | 290 | 88.9% | 100.0% | 0.937 | 88.9% | 97.8% | 0.930 |
| Xenova/bge-base-en-v1.5 | Xenova/ms-marco-MiniLM-L-6-v2 | 23 | 265 | 93.3% | 100.0% | 0.959 | 93.3% | 97.8% | 0.952 |
| Xenova/bge-base-en-v1.5 | jinaai/jina-reranker-v1-tiny-en | 33 | 245 | 91.1% | 100.0% | 0.948 | 91.1% | 97.8% | 0.941 |
| Xenova/bge-base-en-v1.5 | mixedbread-ai/mxbai-rerank-xsmall-v1 | 87 | 873 | 91.1% | 97.8% | 0.950 | 91.1% | 95.6% | 0.933 |

