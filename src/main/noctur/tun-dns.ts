// Noctur: on macOS, points the Mac's ordinary lookups into the tunnel with mihomo's own TUN setting,
// `tun.dns-mode: native`. The core then adds a resolver for every name no other resolver claims,
// pointing at an address inside the tunnel (198.18.0.2), and macOS removes it when the TUN closes or
// the core exits for any reason. Without it, a DNS server on the local network is reached through the
// local subnet's own route, never through the tunnel: names leak to that server unencrypted, blocked
// names fail before mihomo sees a connection, and answers suit the Mac's location instead of the
// proxy's.
//
// A resolver inside the tunnel also keeps macOS on plain DNS. After every DNS change macOS asks each
// server whether it offers encrypted DNS (DDR), and moves every lookup to a public resolver's DoH
// server when it says yes, past mihomo's DNS. mihomo answers that question with no records.
//
// Each network service keeps its own DNS, which lookups bound to an interface use: macOS's Wi-Fi
// check and login window, so a login page on an internal name still loads. A VPN that registers a
// resolver for its own domains keeps those names.
//
// mihomo's `system` nameserver reads /etc/resolv.conf, which then lists only the TUN's address. mihomo
// skips that address, so `system` would be left with no server once it reads the file again (within
// five minutes), and every name a profile sends to `system` would fail. While the TUN sets the DNS,
// `system` is therefore replaced with plain public servers.

/** Stand-ins for `system` while the TUN sets the macOS DNS. Neither offers DDR to macOS. */
export const SYSTEM_DNS_STAND_IN = ['77.88.8.8', '77.88.8.1']

type DnsMode = 'none' | 'exec' | 'service'

interface Profile {
  tun?: { 'dns-mode'?: string }
  dns?: Record<string, unknown>
}

const NAMESERVER_LISTS = [
  'default-nameserver',
  'nameserver',
  'fallback',
  'proxy-server-nameserver',
  'direct-nameserver'
]
const NAMESERVER_POLICIES = ['nameserver-policy', 'proxy-server-nameserver-policy']

function isSystem(server: unknown): boolean {
  return typeof server === 'string' && /^system(:\/\/.*)?$/i.test(server.trim())
}

function withoutSystem(servers: string[]): string[] {
  if (!servers.some(isSystem)) return servers
  const out: string[] = []
  for (const server of servers) {
    for (const s of isSystem(server) ? SYSTEM_DNS_STAND_IN : [server]) {
      if (!out.includes(s)) out.push(s)
    }
  }
  return out
}

/**
 * Turns on the TUN's own DNS on macOS unless the setting is "none" or the profile chose a mode
 * itself, and replaces `system` nameservers while the TUN sets the DNS.
 */
export function applyTunDns(
  profile: Profile,
  mode: DnsMode | undefined,
  platform: NodeJS.Platform = process.platform
): void {
  if (platform !== 'darwin' || !profile.tun || (mode ?? 'exec') === 'none') return
  if (!profile.tun['dns-mode']) profile.tun['dns-mode'] = 'native'
  if (profile.tun['dns-mode'] === 'disabled' || !profile.dns) return

  const dns = profile.dns
  for (const key of NAMESERVER_LISTS) {
    const servers = dns[key]
    if (Array.isArray(servers)) dns[key] = withoutSystem(servers)
  }
  for (const key of NAMESERVER_POLICIES) {
    const policy = dns[key]
    if (!policy || typeof policy !== 'object') continue
    for (const [match, servers] of Object.entries(policy as Record<string, unknown>)) {
      if (typeof servers === 'string' && isSystem(servers)) {
        ;(policy as Record<string, unknown>)[match] = [...SYSTEM_DNS_STAND_IN]
      } else if (Array.isArray(servers)) {
        ;(policy as Record<string, unknown>)[match] = withoutSystem(servers)
      }
    }
  }
}
