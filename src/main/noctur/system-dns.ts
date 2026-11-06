// Noctur: on macOS, points the DNS of every network service into the tunnel while TUN is on, and
// puts the original back afterwards. A DNS server on the local network (the router, an office
// server) is reached through the local subnet's own route, never through the tunnel, so without
// this every lookup bypasses mihomo: names leak to that server unencrypted, blocked names fail
// before mihomo sees a connection, and answers suit the Mac's location instead of the proxy's.
// Lookups sent to a public address enter the tunnel, and mihomo's dns-hijack answers them.
//
// macOS sends a name to a VPN's own resolver when the VPN registers one for its domain (Check
// Point does for the company domain), so such names keep working.
//
// The first choice is a resolver of its own for ordinary lookups (build/noctur-dns/main.c). Each
// service then keeps the network's DNS, which lookups bound to an interface use: macOS's Wi-Fi check
// and login window are bound to Wi-Fi, skip the tunnel, and need the network's DNS for a login page
// on an internal name. When that tool cannot run, every service's DNS is changed instead.
//
// Upstream kept one original for one service and read the mode with two different defaults: the
// start treated unset as "exec", the set and restore steps as "none", so nothing was ever set but
// an original was recorded, which then stopped any later attempt.
import { execFile } from 'child_process'
import { promisify } from 'util'

/** 1.1.1.1 first; macOS falls back to the second. Both are answered by mihomo inside the tunnel. */
export const TUNNEL_DNS = ['1.1.1.1', '77.88.8.8']

export type DnsMode = 'none' | 'exec' | 'service'
export const DEFAULT_DNS_MODE: DnsMode = 'exec'

/** "Empty" means no servers set by hand: the network's own (DHCP) servers are used. */
const EMPTY = 'Empty'

export type DnsToolAction = 'set' | 'clear'

export interface DnsDeps {
  run: (args: string[]) => Promise<string>
  /** The root helper's call, for mode "service". */
  setViaService: (service: string, servers: string[]) => Promise<void>
  /** Runs the setuid resolver tool; rejects when it fails or cannot run. */
  runDnsTool: (action: DnsToolAction) => Promise<void>
  /** The output of `scutil --dns`. */
  readDnsConfig: () => Promise<string>
  log: (message: string) => Promise<void>
  getConfig: () => Promise<{
    autoSetDNSMode?: DnsMode
    originDNS?: string
    originDNSByService?: Record<string, string>
  }>
  patchConfig: (patch: {
    originDNS?: undefined
    originDNSByService?: Record<string, string> | undefined
  }) => Promise<void>
}

export const defaultRun = async (args: string[]): Promise<string> =>
  (await promisify(execFile)('networksetup', args)).stdout

/** Enabled services that have a device (Wi-Fi, Ethernet adapters); VPN apps' entries have none. */
export async function listServices(deps: DnsDeps): Promise<string[]> {
  const lines = (await deps.run(['-listnetworkserviceorder'])).split('\n')
  const services: string[] = []
  for (let i = 0; i < lines.length - 1; i++) {
    const name = lines[i].match(/^\((\d+)\) (.+)$/)?.[2]
    const device = lines[i + 1].match(/Device: ([^)]*)\)/)?.[1]?.trim()
    if (name && device) services.push(name)
  }
  return services
}

async function readDns(deps: DnsDeps, service: string): Promise<string> {
  const out = (await deps.run(['-getdnsservers', service])).trim()
  return out.startsWith("There aren't any DNS Servers") ? EMPTY : out.split('\n').join(' ')
}

async function writeDns(
  deps: DnsDeps,
  mode: DnsMode,
  service: string,
  servers: string
): Promise<void> {
  if (mode === 'service') {
    await deps.setViaService(service, servers === EMPTY ? [] : servers.split(' '))
  } else {
    await deps.run(['-setdnsservers', service, ...servers.split(' ')])
  }
}

/** True when `scutil --dns` puts the tool's resolver first, which is where ordinary lookups go. */
export function tunnelResolverFirst(scutilDns: string): boolean {
  const first = scutilDns.split(/^resolver #/m)[1] ?? ''
  return first.includes(`nameserver[0] : ${TUNNEL_DNS[0]}`) && /flags\s*:.*Supplemental/.test(first)
}

/** macOS applies a new resolver a moment after it is written, so this looks for a few seconds. */
async function resolverInUse(deps: DnsDeps): Promise<boolean> {
  for (let tries = 0; tries < 6; tries++) {
    if (tunnelResolverFirst(await deps.readDnsConfig())) return true
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return false
}

/** Points ordinary lookups into the tunnel: with the resolver, or by changing every service's DNS. */
export async function pointDnsIntoTunnel(deps: DnsDeps): Promise<void> {
  const mode = (await deps.getConfig()).autoSetDNSMode ?? DEFAULT_DNS_MODE
  if (mode === 'none') return
  if (mode === 'exec') {
    try {
      await deps.runDnsTool('set')
      // Services whose DNS was changed by the fallback get the network's DNS back.
      await restoreServices(deps)
      if (await resolverInUse(deps)) {
        await deps.log('[Manager]: tunnel DNS resolver set')
        return
      }
      await deps.runDnsTool('clear')
      await deps.log('[Manager]: macOS is not using the tunnel DNS resolver, changing each service')
    } catch (error) {
      await deps.log(`[Manager]: tunnel DNS resolver failed, changing each service: ${error}`)
    }
  }
  // Read here because the steps above can change what is saved.
  const config = await deps.getConfig()
  // An original from upstream's code: it was recorded while nothing was changed, so it is dropped.
  if (config.originDNS !== undefined) await deps.patchConfig({ originDNS: undefined })
  const saved = { ...(config.originDNSByService ?? {}) }
  const tunnel = TUNNEL_DNS.join(' ')
  const todo: string[] = []
  for (const service of await listServices(deps)) {
    if (service in saved) continue
    const current = await readDns(deps, service)
    // Already pointed into the tunnel with the original lost: the network's servers are the best guess.
    saved[service] = current === tunnel ? EMPTY : current
    todo.push(service)
  }
  // Saved before anything is changed, so a crash in between still leaves a way back.
  await deps.patchConfig({ originDNSByService: saved })
  for (const service of todo) {
    await writeDns(deps, mode, service, tunnel)
  }
}

/** Rejects when the task takes longer than the limit. The task itself keeps running. */
export function withinLimit<T>(task: Promise<T>, what: string, limitMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${what} did not finish in ${limitMs} ms`)),
      limitMs
    )
    task.then(resolve, reject).finally(() => clearTimeout(timer))
  })
}

/**
 * Runs the resolver tool one process at a time. When a process ends, the action asked for last runs
 * if it is not the one that just ended, so a slow call can never undo a newer one. A caller stops
 * waiting at the limit, and its call then counts as failed. A process that never ends blocks later
 * actions, which fail at the limit, but starts no others.
 */
export function createDnsToolRunner(
  exec: (action: DnsToolAction) => Promise<unknown>,
  limitMs: number
): (action: DnsToolAction) => Promise<void> {
  let wanted: DnsToolAction = 'clear'
  let running: Promise<void> | null = null

  const run = async (): Promise<void> => {
    let ran: DnsToolAction
    do {
      ran = wanted
      try {
        await exec(ran)
      } catch (error) {
        if (wanted === ran) throw error
      }
    } while (wanted !== ran)
  }

  return (action) => {
    wanted = action
    running ??= run().finally(() => {
      running = null
    })
    return withinLimit(running, `noctur-dns ${action}`, limitMs)
  }
}

/** Removes the resolver and puts every saved original back. Also used at a start without TUN, after a crash. */
export async function restoreDns(deps: DnsDeps): Promise<void> {
  await clearResolver(deps)
  await restoreServices(deps)
}

/** Removes the resolver. A failure is logged: the next start or a restart of the Mac removes it. */
export async function clearResolver(deps: DnsDeps): Promise<void> {
  try {
    await deps.runDnsTool('clear')
  } catch (error) {
    await deps.log(`[Manager]: could not remove the tunnel DNS resolver: ${error}`)
  }
}

async function restoreServices(deps: DnsDeps): Promise<void> {
  const config = await deps.getConfig()
  if (config.originDNS !== undefined) await deps.patchConfig({ originDNS: undefined })
  const saved = config.originDNSByService
  if (!saved || Object.keys(saved).length === 0) return
  const mode = config.autoSetDNSMode ?? DEFAULT_DNS_MODE
  const services = new Set(await listServices(deps))
  for (const [service, servers] of Object.entries(saved)) {
    // A service removed since (an adapter unplugged for good) has nothing to restore.
    if (!services.has(service)) continue
    await writeDns(deps, mode === 'none' ? DEFAULT_DNS_MODE : mode, service, servers)
  }
  await deps.patchConfig({ originDNSByService: undefined })
}
