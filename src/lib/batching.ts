/**
 * Embedding batches for the worker. Transformers.js pads every text in a
 * batch to the longest one, so batching a 20-token heading with a 170-token
 * paragraph wastes most of the forward pass. Sorting by length first keeps
 * each batch's padding small; the caller maps results back by index.
 */

/** Texts per forward pass. Bounded so a large PDF never spikes worker memory. */
export const EMBED_BATCH_SIZE = 8

export function planBatches(lengths: number[], batchSize: number): number[][] {
  const size = Math.max(1, Math.floor(batchSize))
  const order = lengths
    .map((len, i) => ({ len, i }))
    .sort((a, b) => a.len - b.len || a.i - b.i)
    .map((x) => x.i)
  const batches: number[][] = []
  for (let i = 0; i < order.length; i += size) batches.push(order.slice(i, i + size))
  return batches
}
