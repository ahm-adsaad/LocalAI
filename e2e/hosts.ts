import { MODEL_HOSTS } from '../src/lib/csp'

/** True when a request URL is this origin or one of the model-weight hosts the CSP allows. */
export function hostAllowed(url: string, origin: string): boolean {
  const u = new URL(url)
  if (u.origin === origin) return true
  return MODEL_HOSTS.some((entry) => {
    const [scheme, host] = entry.split('://') as [string, string]
    if (u.protocol !== `${scheme}:`) return false
    if (host.startsWith('*.')) {
      const suffix = host.slice(2)
      return u.hostname === suffix || u.hostname.endsWith(`.${suffix}`)
    }
    return u.hostname === host
  })
}

/** A CSP violation report as Chrome prints it to the console. */
export function isCspViolation(text: string): boolean {
  return /Content[- ]Security[- ]Policy/i.test(text)
}
