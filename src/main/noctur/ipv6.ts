// Noctur: IPv6 through the tunnel on a network without IPv6.
//
// mihomo turns IPv6 off at start when no interface has a global IPv6 address (`verifyIP6` in
// `config/utils.go`): the TUN interface gets no IPv6 address and the fake IPv6 range is dropped, so
// macOS asks DNS for IPv4 only and no app reaches IPv6, although the server has it. The core is
// started with SKIP_SYSTEM_IPV6_CHECK (core/manager.ts), so the TUN keeps its IPv6 address. Lookups
// go into the tunnel, so every lookup reaches the core, and in fake-ip mode the core answers every
// AAAA query itself, empty unless a fake IPv6 range is set, so the range below is added. The server
// then connects by name and uses IPv6 where the site needs it, with IPv4 still preferred. An AAAA
// query gets an address from the range only when both the core setting and the range are present.

// mihomo's documented example range (docs/config.yaml).
export const FAKE_IP_RANGE6 = 'fdfe:dcba:9876::1/64'

interface Ipv6Config {
  ipv6?: boolean
  dns?: { enable?: boolean; ipv6?: boolean; 'enhanced-mode'?: string; 'fake-ip-range6'?: string }
}

// Adds the fake IPv6 range to a fake-ip DNS config that has none, unless IPv6 is turned off.
export function addFakeIPv6Range(profile: Ipv6Config): void {
  const dns = profile.dns
  if (!dns?.enable || dns['enhanced-mode'] !== 'fake-ip') return
  if (profile.ipv6 === false || dns.ipv6 === false) return
  if (dns['fake-ip-range6']) return
  dns['fake-ip-range6'] = FAKE_IP_RANGE6
}
