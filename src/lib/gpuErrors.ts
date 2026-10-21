/** Thrown by the worker when a load is started with `simulateFailure: 'oom'`. */
export const SIMULATED_OOM_MESSAGE =
  'Simulated GPU memory failure (requested by ?simulateOom)'

const GPU_MEMORY_PATTERN = new RegExp(
  [
    'out of memory',
    'oom',
    'device lost',
    'devicelost',
    'insufficient',
    'not enough memory',
    'exceeds',
    'maxbuffersize',
    'maxstoragebuffer',
    'allocation failed',
    'shader-f16',
  ].join('|'),
  'i',
)

/**
 * Heuristic: does this error look like the GPU ran out of memory (or lost the
 * device because of it)? It matches on the message text because WebLLM throws a
 * typed `DeviceLostError` for only one of these cases and plain `Error`s with
 * varying wording for the rest, so there is no reliable type to check.
 */
export function isGpuMemoryFailure(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '')
  return GPU_MEMORY_PATTERN.test(message)
}
