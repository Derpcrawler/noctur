import { net } from 'electron'

// Noctur: the two address tiles on Home. "Your IP" asks
// ipwho.is, "Proxy IP" asks ip.sb's IPv4-only host; each tile's IPv6 line asks an IPv6-only host,
// which has no IPv4 address, so it answers only where IPv6 works. All are ordinary requests from the
// main process, so they take the same path as any app: through TUN or the system proxy while
// connected. The rules below, put first in the core's config, send the direct ones DIRECT and the
// proxied ones through the main group, so each tile shows what it says whatever the profile's own
// rules do with these hosts.

export const DIRECT_HOSTS = ['ipwho.is', 'api4.ipify.org', 'api6.ipify.org']
export const PROXIED_HOSTS = ['api-ipv4.ip.sb', 'api-ipv6.ip.sb']

export type AddressKind = 'direct' | 'proxied' | 'direct6' | 'proxied6'

// The main group: the first select group, or the first group when there is none.
export function mainGroupOf(
  groups: { name?: unknown; type?: unknown }[] | undefined
): string | null {
  const named = (groups ?? []).filter(
    (g): g is { name: string; type?: unknown } => typeof g?.name === 'string' && g.name !== 'GLOBAL'
  )
  return (named.find((g) => g.type === 'select') ?? named[0])?.name ?? null
}

// Rules for the lookups, to put before the profile's own. A group name with a comma cannot be written
// in a rule, so those lookups follow the profile's rules instead.
export function addressRules(groups: { name?: unknown; type?: unknown }[] | undefined): string[] {
  const rules = DIRECT_HOSTS.map((h) => `DOMAIN,${h},DIRECT`)
  const main = mainGroupOf(groups)
  if (main && !main.includes(',')) rules.push(...PROXIED_HOSTS.map((h) => `DOMAIN,${h},${main}`))
  return rules
}

export interface AddressInfo {
  ip: string
  ipv6?: string
  provider?: string
  city?: string
  country?: string
  flag?: string
}

async function get(url: string, timeout = 10_000): Promise<Response> {
  const res = await net.fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(timeout) })
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`)
  return res
}
const getJson = async (url: string): Promise<Record<string, unknown>> =>
  (await (await get(url)).json()) as Record<string, unknown>

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)

function flagOf(code: unknown): string | undefined {
  if (typeof code !== 'string' || !/^[A-Za-z]{2}$/.test(code)) return undefined
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}

// The IPv6 lines: a short wait, since a network without IPv6 never answers.
async function ipv6Of(url: string, json: boolean): Promise<string | null> {
  const res = await get(url, 5_000)
  const ip = json
    ? str(((await res.json()) as Record<string, unknown>).ip)
    : (await res.text()).trim()
  return ip && ip.includes(':') ? ip : null
}

export async function lookUpAddress(kind: AddressKind): Promise<AddressInfo | string | null> {
  if (kind === 'direct6') return ipv6Of(`https://${DIRECT_HOSTS[2]}/?format=json`, true)
  if (kind === 'proxied6') return ipv6Of(`https://${PROXIED_HOSTS[1]}/ip`, false)
  if (kind === 'proxied') {
    const r = await getJson(`https://${PROXIED_HOSTS[0]}/geoip`)
    const ip = str(r.ip)
    if (!ip) throw new Error('no address in the answer')
    return {
      ip,
      provider: str(r.isp) ?? str(r.organization),
      city: str(r.city),
      country: str(r.country),
      flag: flagOf(r.country_code)
    }
  }
  const r = await getJson(`https://${DIRECT_HOSTS[0]}/`)
  let ip = str(r.ip)
  if (!ip || r.success === false) throw new Error('no address in the answer')
  // ipwho.is answered over IPv6: that is the IPv6 line, and the IPv4 address comes from an IPv4-only host.
  let ipv6: string | undefined
  if (ip.includes(':')) {
    ipv6 = ip
    ip = str((await getJson(`https://${DIRECT_HOSTS[1]}/?format=json`)).ip) ?? ip
  }
  const conn = (r.connection ?? {}) as Record<string, unknown>
  const flag = (r.flag ?? {}) as Record<string, unknown>
  return {
    ip,
    ipv6,
    provider: str(conn.isp) ?? str(conn.org),
    city: str(r.city),
    country: str(r.country),
    flag: str(flag.emoji) ?? flagOf(r.country_code)
  }
}
