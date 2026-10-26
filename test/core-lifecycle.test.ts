// The core lifecycle through the production callers: the real startCore, stopCore and
// mihomoHotReloadConfig run against a fake core process whose stdout the test writes. Startup
// settles for a silent core, a spawn error and an exit. After each successful hot reload the window
// is told to refresh groups and rules once that reload's providers have started, and a failed
// reload announces nothing. A config naming a core that is not shipped starts the built-in one. A
// missing core file and a config the core refuses are reported as such.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

class FakeCore extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  pid = 4242
  exitCode: number | null = null
  signalCode: string | null = null
  killed = false
  kill(signal = 'SIGTERM'): boolean {
    this.killed = true
    if (this.signalCode !== null || this.exiting) return true
    this.exiting = true
    const exit = (): void => {
      this.signalCode = signal
      this.emit('exit', null, signal)
      this.emit('close', null, signal)
    }
    // A real core takes a moment to exit after a signal.
    if (s.exitDelayMs > 0) setTimeout(exit, s.exitDelayMs)
    else setImmediate(exit)
    return true
  }
  exiting = false
  unref(): void {
    // nothing to detach in tests
  }
}

const s = vi.hoisted(() => ({
  dir: '',
  cores: [] as unknown[],
  sent: [] as string[],
  errors: [] as string[],
  puts: [] as string[],
  putFails: false,
  // The controller's error body for a config it refuses (axios rejects with the response body).
  putRefusal: null as null | { message: string },
  corePath: '/usr/bin/true',
  holdPuts: false,
  heldPuts: [] as { resolve: () => void; reject: (e: Error) => void }[],
  apiUp: true,
  runtime: {} as Record<string, unknown>,
  appConfig: {} as Record<string, unknown>,
  // Holds the DNS restore at its first system call (route) once, until released.
  dnsHold: null as null | Promise<void>,
  exitDelayMs: 0
}))

vi.mock('child_process', async (orig) => {
  const real = await orig<typeof import('child_process')>()
  const { promisify } = await import('util')
  const realRun = promisify(real.execFile)
  const run = async (file: string, args: string[], ...rest: unknown[]): Promise<{ stdout: string; stderr: string }> => {
    // The DNS restore's system calls never reach the real commands (networksetup would change this
    // machine's DNS): they fail, after the one held call when a test holds it.
    if (file === 'route' || file === 'networksetup') {
      const hold = s.dnsHold
      s.dnsHold = null
      if (hold) await hold
      throw new Error(`${file} is not run in tests`)
    }
    return realRun(file, args, ...(rest as [])) as Promise<{ stdout: string; stderr: string }>
  }
  const execFile = Object.assign(
    (file: string, args: string[], ...rest: unknown[]) => {
      const cb = rest.at(-1) as (e: Error | null, out?: string, err?: string) => void
      run(file, args).then((r) => cb(null, r.stdout, r.stderr), (e) => cb(e))
    },
    { [promisify.custom]: run }
  )
  return {
    ...real,
    execFile,
    spawn: () => {
      const core = new FakeCore()
      s.cores.push(core)
      return core
    }
  }
})
vi.mock('../src/main/index', () => ({
  mainWindow: { webContents: { send: (ch: string) => s.sent.push(ch) } },
  showError: (title: string) => {
    s.errors.push(title)
  }
}))
vi.mock('../src/main/config', () => ({
  getAppConfig: async () => s.appConfig,
  getControledMihomoConfig: async () => ({ tun: { enable: false } }),
  getProfileConfig: async () => ({ current: 'p1' }),
  patchAppConfig: async (patch: Record<string, unknown>) => {
    Object.assign(s.appConfig, patch)
  },
  patchControledMihomoConfig: async () => {}
}))
vi.mock('../src/main/core/factory', () => ({
  generateProfile: async () => ({ logLevel: 'info' }),
  getRuntimeConfig: async () => s.runtime
}))
vi.mock('../src/main/utils/dirs', () => ({
  dataDir: () => s.dir,
  logPath: () => join(s.dir, 'core.log'),
  // checkProfile runs it with -t. Like the real one, it knows no core but the built-in one.
  mihomoCorePath: (core: string) => {
    if (core !== 'mihomo') throw new Error('error.corePathError')
    return s.corePath
  },
  mihomoIpcPath: () => join(s.dir, 'api.sock'),
  mihomoProfileWorkDir: () => s.dir,
  mihomoTestDir: () => s.dir,
  mihomoWorkConfigPath: () => join(s.dir, 'config.yaml'),
  mihomoWorkDir: () => s.dir
}))
vi.mock('../src/main/core/mihomoApi', async (orig) => {
  const real = await orig<typeof import('../src/main/core/mihomoApi')>()
  const noop = async (): Promise<void> => {}
  return {
    ...real,
    startMihomoTraffic: noop,
    startMihomoConnections: noop,
    startMihomoLogs: () => {},
    startMihomoMemory: noop,
    stopMihomoTraffic: () => {},
    stopMihomoConnections: () => {},
    stopMihomoLogs: () => {},
    stopMihomoMemory: () => {},
    applyLogLevel: noop,
    mihomoGroups: async () => {
      if (!s.apiUp) throw new Error('api down')
      return []
    }
  }
})
vi.mock('axios', () => ({
  default: {
    create: () => ({
      defaults: { socketPath: '' },
      interceptors: { response: { use: () => {} } },
      put: async (url: string) => {
        s.puts.push(url)
        if (s.holdPuts) {
          await new Promise<void>((resolve, reject) => s.heldPuts.push({ resolve, reject }))
          return {}
        }
        if (s.putFails) throw new Error('reload rejected')
        if (s.putRefusal) throw s.putRefusal
        return {}
      },
      patch: async () => ({}),
      get: async () => ({})
    })
  }
}))
vi.mock('../src/main/resolve/tray', () => ({ tray: null }))
vi.mock('../src/main/resolve/floatingWindow', () => ({ floatingWindow: null }))
vi.mock('../src/main/sys/sysproxy', () => ({ triggerSysProxy: async () => {}, disableSysProxy: async () => {} }))
vi.mock('../src/main/service/api', () => ({ setSysDns: async () => {} }))
vi.mock('../src/main/utils/i18n', () => ({ t: (k: string) => k }))

const manager = await import('../src/main/core/manager')
const { mihomoHotReloadConfig } = await import('../src/main/core/mihomoApi')

const LISTEN = 'level=info msg="RESTful API unix listening at: /tmp/a.sock"\n'
const DEFAULT = 'level=info msg="Start initial compatible provider default"\n'
const provider = (n: string): string => `level=info msg="Start initial provider ${n}"\n`
const latest = (): FakeCore => s.cores[s.cores.length - 1] as FakeCore
const refreshes = (): number => s.sent.filter((c) => c === 'groupsUpdated').length
const rulesRefreshes = (): number => s.sent.filter((c) => c === 'rulesUpdated').length
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const settled = (p: Promise<unknown>, ms = 300): Promise<string> =>
  Promise.race([
    p.then(
      () => 'resolved',
      () => 'rejected'
    ),
    sleep(ms).then(() => 'pending')
  ])

async function spawned(): Promise<FakeCore> {
  const before = s.cores.length
  for (let i = 0; i < 100 && s.cores.length === before; i++) await sleep(5)
  return latest()
}

beforeEach(async () => {
  await manager.stopCore(true)
  s.dir = mkdtempSync(join(tmpdir(), 'noctur-core-'))
  s.sent = []
  s.puts = []
  s.putFails = false
  s.putRefusal = null
  s.corePath = '/usr/bin/true'
  s.holdPuts = false
  s.heldPuts = []
  s.apiUp = true
  s.runtime = {}
  if (manager.STARTUP_LIMITS) Object.assign(manager.STARTUP_LIMITS, { controllerMs: 30_000, providersMs: 30_000, apiTries: 3 })
})

describe('startCore', () => {
  it('settles for a core that never writes anything', async () => {
    if (manager.STARTUP_LIMITS) Object.assign(manager.STARTUP_LIMITS, { controllerMs: 50, providersMs: 50 })
    const start = manager.startCore()
    await spawned()
    const [ready] = await start // resolved by the deadline because the API answers
    expect(await settled(ready)).toBe('resolved')
  })

  it('fails for a silent core whose API does not answer', async () => {
    if (manager.STARTUP_LIMITS) Object.assign(manager.STARTUP_LIMITS, { controllerMs: 50, providersMs: 50 })
    s.apiUp = false
    const start = manager.startCore()
    await spawned()
    expect(await settled(start, 2000)).toBe('rejected')
  })

  it('fails on a spawn error without an uncaught error', async () => {
    const start = manager.startCore()
    const core = await spawned()
    expect(() => core.emit('error', new Error('spawn ENOENT'))).not.toThrow()
    expect(await settled(start)).toBe('rejected')
  })

  it('fails when the core exits before the controller listens', async () => {
    const start = manager.startCore()
    const core = await spawned()
    core.exitCode = 1
    core.emit('exit', 1, null)
    expect(await settled(start)).toBe('rejected')
  })

  it('starts the built-in core when the config names the alpha core', async () => {
    s.appConfig = { core: 'mihomo-alpha' }
    const start = manager.startCore()
    ;(await spawned()).stdout.write(LISTEN + DEFAULT)
    const [ready] = await start
    expect(await settled(ready)).toBe('resolved')
    expect(s.appConfig.core).toBe('mihomo')
    s.appConfig = {}
  })

  it('reports a missing core file as missing, not as a failed config check', async () => {
    s.corePath = join(s.dir, 'quarantined-mihomo')
    await expect(manager.startCore()).rejects.toThrow(/tray\.coreMissing/)
  })

  it('becomes ready with controller and provider lines in one chunk', async () => {
    const start = manager.startCore()
    ;(await spawned()).stdout.write(LISTEN + DEFAULT)
    const [ready] = await start
    expect(await settled(ready)).toBe('resolved')
    expect(refreshes()).toBe(1)
  })
})

describe('hot reload', () => {
  async function running(): Promise<FakeCore> {
    const start = manager.startCore()
    const core = await spawned()
    core.stdout.write(LISTEN + DEFAULT)
    const [ready] = await start
    await ready
    await sleep(150) // the first refresh is sent 100 ms after readiness
    return core
  }

  it('refreshes groups and rules after each successful reload', async () => {
    const core = await running()
    expect([refreshes(), rulesRefreshes()]).toEqual([1, 1])

    await mihomoHotReloadConfig()
    expect(s.puts).toEqual(['/configs?force=true'])
    core.stdout.write(DEFAULT)
    await sleep(20)
    expect([refreshes(), rulesRefreshes()]).toEqual([2, 2])

    // Second reload, now with named providers: refreshed only when all of them have started.
    s.runtime = { 'rule-providers': { ads: {} }, 'proxy-providers': { sub: {} } }
    await mihomoHotReloadConfig()
    core.stdout.write(provider('ads'))
    await sleep(20)
    expect(refreshes()).toBe(2)
    core.stdout.write(provider('sub'))
    await sleep(20)
    expect([refreshes(), rulesRefreshes()]).toEqual([3, 3])
  })

  it('reports a config the core refuses as a refused profile', async () => {
    await running()
    s.putRefusal = { message: 'proxy group[0]: missing name' }
    await expect(mihomoHotReloadConfig()).rejects.toThrow(/^Profile Check Failed:\nproxy group\[0\]: missing name$/)
  })

  it('announces nothing after a failed reload', async () => {
    const core = await running()
    s.putFails = true
    await expect(mihomoHotReloadConfig()).rejects.toThrow('reload rejected')
    core.stdout.write(DEFAULT)
    await sleep(20)
    expect(refreshes()).toBe(1)
  })
})

describe('overlapping reloads', () => {
  async function running(): Promise<FakeCore> {
    const start = manager.startCore()
    const core = await spawned()
    core.stdout.write(LISTEN + DEFAULT)
    const [ready] = await start
    await ready
    await sleep(150)
    return core
  }
  async function held(n: number): Promise<void> {
    for (let i = 0; i < 200 && s.heldPuts.length < n; i++) await sleep(5)
    expect(s.heldPuts.length).toBe(n)
  }

  it('an older failed reload does not cancel a newer successful one', async () => {
    const core = await running()
    s.holdPuts = true
    const a = mihomoHotReloadConfig()
    await held(1)
    s.runtime = { 'proxy-providers': { newSubscription: {} } }
    const b = mihomoHotReloadConfig()
    await held(2)
    s.heldPuts[1].resolve() // B succeeds
    await b
    s.heldPuts[0].reject(new Error('A failed')) // then A fails
    await expect(a).rejects.toThrow('A failed')
    core.stdout.write(provider('newSubscription'))
    await sleep(30)
    expect([refreshes(), rulesRefreshes()]).toEqual([2, 2]) // B refreshed exactly once
  })

  it('a newer failed reload does not cancel an older successful one', async () => {
    const core = await running()
    s.holdPuts = true
    const a = mihomoHotReloadConfig() // default provider only
    await held(1)
    s.runtime = { 'proxy-providers': { other: {} } }
    const b = mihomoHotReloadConfig()
    await held(2)
    s.heldPuts[1].reject(new Error('B failed'))
    await expect(b).rejects.toThrow('B failed')
    s.heldPuts[0].resolve()
    await a
    core.stdout.write(DEFAULT)
    await sleep(30)
    expect([refreshes(), rulesRefreshes()]).toEqual([2, 2]) // A refreshed once, B stayed quiet
    core.stdout.write(provider('other'))
    await sleep(30)
    expect(refreshes()).toBe(2)
  })

  it('an obsolete reload failing after a restart does not cancel the new start', async () => {
    await running()
    s.holdPuts = true
    const a = mihomoHotReloadConfig()
    await held(1)
    s.errors = []
    const restart = manager.restartCore()
    const fresh = await spawned()
    s.heldPuts[0].reject(new Error('A failed'))
    await expect(a).rejects.toThrow('A failed')
    fresh.stdout.write(LISTEN + DEFAULT)
    await restart
    await sleep(150)
    expect(s.errors).toEqual([])
    expect(refreshes()).toBe(2)
  })
})

describe('stop during a slow DNS restore', () => {
  it.runIf(process.platform === 'darwin')('sends SIGINT to the core before waiting for the DNS restore', async () => {
    const start = manager.startCore()
    const core = await spawned()
    core.stdout.write(LISTEN + DEFAULT)
    // The stop below cancels the readiness wait; the app's callers handle that rejection.
    ;(await start).forEach((ready) => ready.catch(() => {}))
    const signals: string[] = []
    const kill = core.kill.bind(core)
    core.kill = (signal = 'SIGTERM'): boolean => {
      signals.push(signal)
      return kill(signal)
    }
    let release!: () => void
    s.dnsHold = new Promise<void>((r) => (release = r))
    s.appConfig = { originDNS: '192.0.2.1', autoSetDNSMode: 'exec' }
    try {
      const stop = manager.stopCore()
      await sleep(50)
      expect(signals).toEqual(['SIGINT']) // the DNS restore is still held
      release()
      await stop
    } finally {
      release?.()
      s.dnsHold = null
      s.appConfig = {}
    }
  })
})

describe('overlapping stops and starts', () => {
  it.runIf(process.platform === 'darwin')(
    'keeps tracking a core started while an earlier stop restores DNS',
    async () => {
      const start = manager.startCore()
      ;(await spawned()).stdout.write(LISTEN + DEFAULT)
      ;(await start).forEach((ready) => ready.catch(() => {}))
      let release!: () => void
      s.dnsHold = new Promise<void>((r) => (release = r))
      s.appConfig = { originDNS: '192.0.2.1', autoSetDNSMode: 'exec' }
      try {
        const stop = manager.stopCore() // held in the DNS restore
        await sleep(20)
        const before = s.cores.length
        const restart = manager.startCore() // its own DNS restore fails fast
        for (let i = 0; i < 100 && s.cores.length === before; i++) await sleep(5)
        ;(s.cores.at(-1) as FakeCore).stdout.write(LISTEN + DEFAULT)
        ;(await restart).forEach((ready) => ready.catch(() => {}))
        release()
        await stop
        expect(manager.hasCoreProcess()).toBe(true) // the new core is still the one tracked
      } finally {
        release?.()
        s.dnsHold = null
        s.appConfig = {}
      }
    }
  )

  it('two quick restarts end with one tracked core and no long stall', async () => {
    const firstNew = s.cores.length
    const start = manager.startCore()
    ;(await spawned()).stdout.write(LISTEN + DEFAULT)
    ;(await start).forEach((ready) => ready.catch(() => {}))
    s.exitDelayMs = 200
    const fed = new Set<unknown>(s.cores)
    let feeding = true
    const feeder = (async (): Promise<void> => {
      while (feeding) {
        for (const core of s.cores) {
          if (!fed.has(core)) {
            fed.add(core)
            ;(core as FakeCore).stdout.write(LISTEN + DEFAULT)
          }
        }
        await sleep(5)
      }
    })()
    try {
      const started = Date.now()
      const first = manager.restartCore()
      await sleep(5)
      const second = manager.restartCore()
      await Promise.all([first, second])
      const elapsed = Date.now() - started
      await sleep(250)
      const running = (s.cores.slice(firstNew) as FakeCore[]).filter(
        (c) => c.signalCode === null && c.exitCode === null
      )
      expect(elapsed).toBeLessThan(3000)
      expect(running.length).toBe(1)
      expect(manager.hasCoreProcess()).toBe(true)
    } finally {
      feeding = false
      await feeder
      s.exitDelayMs = 0
    }
  })
})

// Last in this file: an accepted quit is permanent for the rest of the process.
describe('restart during an accepted quit', () => {
  it('does not start a new core when the quit is accepted while the old one stops', async () => {
    const { beginShutdown } = await import('../src/main/sys/shutdown')
    const start = manager.startCore()
    ;(await spawned()).stdout.write(LISTEN + DEFAULT)
    // restartCore below stops this core and cancels its readiness wait; the app's callers handle it.
    ;(await start).forEach((ready) => ready.catch(() => {}))
    const before = s.cores.length
    s.errors = []

    const restart = manager.restartCore()
    beginShutdown() // accepted while restartCore is stopping the old core
    await restart
    expect(s.cores.length).toBe(before)
    expect(s.errors).toEqual([])

    // A start that is already past its first steps is refused right before the spawn.
    await expect(manager.startCore()).rejects.toBeInstanceOf(manager.ShutdownInProgress)
    expect(s.cores.length).toBe(before)
  })
})
