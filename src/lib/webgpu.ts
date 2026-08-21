export type WebGPUStatus =
  | {
      ok: true
      adapterName?: string
      vendor?: string
      /** Best-effort device memory estimate in MiB; undefined if the browser hides it. */
      vramMb?: number
      vramSource: 'adapter-info' | 'unknown'
    }
  | { ok: false; reason: string }

type AdapterInfoLike = {
  device?: string
  vendor?: string
  description?: string
  memoryHeaps?: Array<{ size?: number }>
}

/**
 * WebGPU is the hard gate for this app. Without it, WebLLM cannot run the
 * quantized model on the GPU, and we refuse to fall back to a remote API —
 * that would break the privacy premise.
 *
 * VRAM probing stays on-device (adapter metadata only). Many browsers omit
 * heap sizes; we then recommend Balanced and let the user pick Fast/Quality.
 */
export async function checkWebGPU(): Promise<WebGPUStatus> {
  if (typeof navigator === 'undefined' || !('gpu' in navigator) || !navigator.gpu) {
    return {
      ok: false,
      reason:
        'This browser does not expose navigator.gpu. Use a recent Chrome, Edge, or another browser with WebGPU enabled.',
    }
  }

  try {
    const adapter = await Promise.race([
      navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8_000)),
    ])

    if (!adapter) {
      return {
        ok: false,
        reason:
          'WebGPU is present but no GPU adapter was returned within 8s. Check that hardware acceleration is enabled and drivers are up to date.',
      }
    }

    const info = await readAdapterInfo(adapter)
    const vramMb = estimateVramMb(info)

    return {
      ok: true,
      adapterName: info?.device || info?.description,
      vendor: info?.vendor,
      vramMb,
      vramSource: vramMb != null ? 'adapter-info' : 'unknown',
    }
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : 'Failed to request a WebGPU adapter.',
    }
  }
}

async function readAdapterInfo(adapter: GPUAdapter): Promise<AdapterInfoLike | undefined> {
  const withInfo = adapter as GPUAdapter & {
    info?: AdapterInfoLike
    requestAdapterInfo?: () => Promise<AdapterInfoLike>
  }

  if (withInfo.info) return withInfo.info

  if (typeof withInfo.requestAdapterInfo === 'function') {
    try {
      return await withInfo.requestAdapterInfo()
    } catch {
      return undefined
    }
  }
  return undefined
}

function estimateVramMb(info: AdapterInfoLike | undefined): number | undefined {
  if (!info?.memoryHeaps?.length) return undefined
  let bytes = 0
  for (const heap of info.memoryHeaps) {
    if (typeof heap.size === 'number' && heap.size > 0) bytes += heap.size
  }
  if (bytes <= 0) return undefined
  return Math.round(bytes / (1024 * 1024))
}
