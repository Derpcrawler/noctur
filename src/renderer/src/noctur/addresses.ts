import { create } from 'zustand'

// Noctur: the Home address tiles' results (main/noctur/address.ts does the lookups): a
// result is kept for ten minutes and a failed lookup keeps the last one. The proxied address is kept
// per server traffic leaves through, so switching servers looks it up again and switching back shows
// the earlier one at once. The IPv4 address shows as soon as it is known; the IPv6 one is asked for
// after it, and until it answers the tile keeps the last IPv6 line, so a network without IPv6 does not
// hold the tile back and the line does not blink at each check.

export interface AddressInfo {
  ip: string
  // The IPv6 address, when the network (or, through the server, the exit) has one.
  ipv6?: string
  provider?: string
  city?: string
  country?: string
  flag?: string
}

interface Entry {
  info: AddressInfo
  at: number
}

type Kind = 'direct' | 'proxied'

interface AddressState {
  direct?: Entry
  proxied: Record<string, Entry>
  busy: Record<Kind, boolean>
  // The last lookup of that kind failed (and none has worked since).
  failed: Record<Kind, boolean>
}

export const MAX_AGE = 10 * 60_000

export const useAddresses = create<AddressState>(() => ({
  proxied: {},
  busy: { direct: false, proxied: false },
  failed: { direct: false, proxied: false }
}))

const invoke = async (kind: string): Promise<unknown> => {
  const res = await window.electron.ipcRenderer.invoke('nocturAddress', kind)
  if (res && typeof res === 'object' && 'invokeError' in res) throw res.invokeError
  return res
}

const entryOf = (kind: Kind, server: string): Entry | undefined => {
  const s = useAddresses.getState()
  return kind === 'direct' ? s.direct : s.proxied[server]
}

const store = (kind: Kind, server: string, entry: Entry): void =>
  useAddresses.setState((st) =>
    kind === 'direct' ? { direct: entry } : { proxied: { ...st.proxied, [server]: entry } }
  )

// Looks the address up when there is no result younger than MAX_AGE, or always with `force`.
// `server` names the server a proxied lookup goes through.
export async function refreshAddress(kind: Kind, server = '', force = false): Promise<void> {
  const s = useAddresses.getState()
  if (s.busy[kind]) return
  const cached = entryOf(kind, server)
  if (!force && cached && Date.now() - cached.at < MAX_AGE) {
    // A fresh address without its IPv6 line asks for that line again at each check: the first try can
    // fail while the route is still coming up after a launch.
    if (!cached.info.ipv6) await askIPv6(kind, server, cached.info.ip)
    return
  }
  useAddresses.setState((st) => ({ busy: { ...st.busy, [kind]: true } }))
  let info: AddressInfo
  try {
    info = (await invoke(kind)) as AddressInfo
    store(kind, server, { info: { ...info, ipv6: info.ipv6 ?? cached?.info.ipv6 }, at: Date.now() })
    useAddresses.setState((st) => ({ failed: { ...st.failed, [kind]: false } }))
  } catch {
    useAddresses.setState((st) => ({ failed: { ...st.failed, [kind]: true } }))
    return
  } finally {
    useAddresses.setState((st) => ({ busy: { ...st.busy, [kind]: false } }))
  }
  // The IPv6 line: from the IPv4 answer when it came over IPv6, else asked for now.
  if (!info.ipv6) await askIPv6(kind, server, info.ip)
}

const asking6: Record<Kind, boolean> = { direct: false, proxied: false }

// Asks for the IPv6 line of the address `ip`. No answer means the address has no IPv6, and the line is removed.
async function askIPv6(kind: Kind, server: string, ip: string): Promise<void> {
  if (asking6[kind]) return
  asking6[kind] = true
  let ipv6: string | undefined
  try {
    const v6 = await invoke(`${kind}6`)
    ipv6 = typeof v6 === 'string' && v6.includes(':') ? v6 : undefined
  } catch {
    ipv6 = undefined
  } finally {
    asking6[kind] = false
  }
  const now = entryOf(kind, server)
  if (now && now.info.ip === ip && now.info.ipv6 !== ipv6) {
    store(kind, server, { ...now, info: { ...now.info, ipv6 } })
  }
}

// "Amsterdam, Netherlands 🇳🇱": the place, then the flag, since the tiles are aligned to the left.
export function placeOf(info: AddressInfo): string {
  const where = [info.city, info.country].filter(Boolean).join(', ')
  return [where, info.flag].filter(Boolean).join(' ')
}
