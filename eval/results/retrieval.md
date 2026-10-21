# Retrieval eval

Corpus: 4 PDFs, 22 chunks. Embedder: Xenova/all-MiniLM-L6-v2. Reranker: Xenova/ms-marco-MiniLM-L-6-v2 over the top 8 fused candidates. Candidate pool: 24.

## Single-turn questions (n=45)

| Strategy | hit@1 | hit@3 | hit@5 | MRR |
| --- | --- | --- | --- | --- |
| dense | 82.2% | 93.3% | 100.0% | 0.886 |
| bm25 | 88.9% | 95.6% | 97.8% | 0.927 |
| hybrid | 88.9% | 100.0% | 100.0% | 0.933 |
| reranked | 93.3% | 100.0% | 100.0% | 0.959 |
| selected | 93.3% | 100.0% | 100.0% | 0.959 |
| excerptHead | 40.0% | 46.7% | 46.7% | 0.426 |
| excerptLexical | 93.3% | 97.8% | 97.8% | 0.952 |
| excerpt | 93.3% | 100.0% | 100.0% | 0.959 |

## Follow-up questions asked verbatim, without rewriting (n=4)

These depend on earlier turns ("when does *her* lease end?"). This is the baseline the in-app question rewriting is measured against.

| Strategy | hit@1 | hit@3 | hit@5 | MRR |
| --- | --- | --- | --- | --- |
| dense | 50.0% | 50.0% | 75.0% | 0.575 |
| bm25 | 75.0% | 100.0% | 100.0% | 0.833 |
| hybrid | 75.0% | 75.0% | 100.0% | 0.813 |
| reranked | 100.0% | 100.0% | 100.0% | 1.000 |
| selected | 100.0% | 100.0% | 100.0% | 1.000 |
| excerptHead | 75.0% | 75.0% | 75.0% | 0.750 |
| excerptLexical | 100.0% | 100.0% | 100.0% | 1.000 |
| excerpt | 100.0% | 100.0% | 100.0% | 1.000 |

Mean excerpt length: lexical window 281 chars, shipped (window + anchored sentence on disagreement) 296 chars.

No misses in the selected set.
