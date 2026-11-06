// The tunnel resolver in the core's lifecycle, through the real startCore, stopCore and restartCore.
// The resolver tool, scutil and networksetup are recorded fakes that never reach the real programs:
// - a tool that never returns (it runs as root, so the app cannot kill it) must not stop restarts,
//   and must not pile up processes;
// - a slow tool call that ends after a newer action must not undo that action;
// - retries while offline must not start the tool again;
// - a quit while macOS reports no network must still remove the resolver, which needs no network;
// - a quit accepted during a start must not set the resolver again after the quit removed it.
import { EventEmitter } from 'events'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PassThrough } from 'stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { net } from 'electron'

class FakeCore extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  pid = 4242
  exitCode: number | null = null
  signalCode: string | null = null
  killed = false
  kill(signal = 'SIGTERM'): boolean {
    this.killed = true
    if (this.signalCode !== null) return true
    setImmediate(() => {
      this.signalCode = signal
      this.emit('exit', null, signal)
      this.emit('close', null, signal)
    })
    return true
  }
  unref(): void {
    // nothing to detach in tests
  }
}

const RESOLVER_FIRST = `DNS configuration

resolver #1
  nameserver[0] : 1.1.1.1
  flags    : Supplemental, Request A records
`

const s = vi.hoisted(() => ({
  dir: '',
  cores: [] as unknown[],
  tool: [] as string[],
  toolHangs: null as null | string,
  toolHang: null as null | (() => void),
  toolRunning: 0,
  toolMost: 0,
  // The next call of this action takes this long. The fake Mac's state changes when a call ends.
  slow: null as null | { action: string; ms: number },
  resolver: false,
  clearHold: null as null | Promise<void>,
  tun: false,
  appConfig: {} as Record<string, unknown>
}))

vi.mock('child_process', async (orig) => {
  const real = await orig<typeof import('child_process')>()
  const { promisify } = await import('util')
  const realRun = promisify(real.execFile)
  const run = async (file: string, args: string[]): Promise<{ stdout: string; stderr: string }> => {
    if (file.endsWith('/noctur-dns')) {
      s.tool.push(args[0])
      s.toolRunning++
      s.toolMost = Math.max(s.toolMost, s.toolRunning)
      if (s.toolHangs === args[0]) await new Promise<void>((r) => (s.toolHang = r))
      if (args[0] === 'clear' && s.clearHold) await s.clearHold
      if (s.slow?.action === args[0]) {
        const { ms } = s.slow
        s.slow = null
        await new Promise((r) => setTimeout(r, ms))
      }
      s.resolver = args[0] === 'set'
      s.toolRunning--
      return { stdout: '', stderr: '' }
    }
    if (file === '/usr/sbin/scutil') return { stdout: RESOLVER_FIRST, stderr: '' }
    if (file === 'route' || file === 'networksetup') throw new Error(`${file} is not run in tests`)
    return realRun(file, args) as Promise<{ stdout: string; stderr: string }>
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
  mainWindow: { webContents: { send: () => {} } },
  showError: () => {}
}))
vi.mock('../src/main/config', () => ({
  getAppConfig: async () => s.appConfig,
  getControledMihomoConfig: async () => ({ tun: { enable: s.tun } }),
  getProfileConfig: async () => ({ current: 'p1' }),
  patchAppConfig: async (patch: Record<string, unknown>) => {
    Object.assign(s.appConfig, patch)
  },
  patchControledMihomoConfig: async () => {}
}))
vi.mock('../src/main/core/factory', () => ({
  generateProfile: async () => ({ logLevel: 'info' }),
  getRuntimeConfig: async () => ({})
}))
vi.mock('../src/main/utils/dirs', () => ({
  dataDir: () => s.dir,
  logPath: () => join(s.dir, 'core.log'),
  // A folder that does not exist: the tool is the recorded fake above, never a file.
  mihomoCoreDir: () => '/nonexistent/sidecar',
  mihomoCorePath: () => '/usr/bin/true',
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
    mihomoGroups: async () => []
  }
})
vi.mock('axios', () => ({
  default: {
    create: () => ({
      defaults: { socketPath: '' },
      interceptors: { response: { use: () => {} } },
      put: async () => ({}),
      patch: async () => ({}),
      get: async () => ({})
    })
  }
}))
vi.mock('../src/main/resolve/tray', () => ({ tray: null }))
vi.mock('../src/main/resolve/floatingWindow', () => ({ floatingWindow: null }))
vi.mock('../src/main/sys/sysproxy', () => ({
  triggerSysProxy: async () => {},
  disableSysProxy: async () => {}
}))
vi.mock('../src/main/service/api', () => ({ setSysDns: async () => {} }))
vi.mock('../src/main/utils/i18n', () => ({ t: (k: string) => k }))

const manager = await import('../src/main/core/manager')
const { beginShutdown } = await import('../src/main/sys/shutdown')

const LISTEN = 'level=info msg="RESTful API unix listening at: /tmp/a.sock"\n'
const DEFAULT = 'level=info msg="Start initial compatible provider default"\n'
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function newCore(before: number, ms: number): Promise<FakeCore | null> {
  for (let i = 0; i < ms / 5 && s.cores.length === before; i++) await sleep(5)
  return s.cores.length === before ? null : (s.cores.at(-1) as FakeCore)
}

async function startAndListen(): Promise<void> {
  const before = s.cores.length
  const start = manager.startCore()
  const core = await newCore(before, 5000)
  core?.stdout.write(LISTEN + DEFAULT)
  ;(await start).forEach((ready) => ready.catch(() => {}))
}

// The offline retry timer stays fake, so it cannot fire during a later test.
async function withFakeTimers(body: () => Promise<void>): Promise<void> {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    await body()
  } finally {
    vi.useRealTimers()
  }
}

beforeEach(() => {
  s.dir = mkdtempSync(join(tmpdir(), 'noctur-dns-lifecycle-'))
  s.tool = []
  s.toolHangs = null
  s.toolHang = null
  s.toolRunning = 0
  s.toolMost = 0
  s.slow = null
  s.resolver = false
  s.clearHold = null
  s.tun = false
  s.appConfig = { autoSetDNSMode: 'exec' }
  net.isOnline = (): boolean => true
})

describe.runIf(process.platform === 'darwin')('tunnel resolver in the core lifecycle', () => {
  it('starts a new core when the resolver tool never returns', async () => {
    await startAndListen()
    s.toolHangs = 'clear'
    const before = s.cores.length
    const restart = manager.restartCore()
    const core = await newCore(before, 8000)
    expect(core).not.toBeNull()
    core?.stdout.write(LISTEN + DEFAULT)
    await restart
    expect(s.toolMost).toBe(1)
    // Let the runner finish, so the next test starts with no tool process.
    s.toolHangs = null
    s.toolHang?.()
    await sleep(50)
  }, 15000)

  it('keeps the resolver when a slow clear ends after the set of the next start', async () => {
    s.tun = true
    await startAndListen()
    expect(s.resolver).toBe(true)
    s.slow = { action: 'clear', ms: 4000 }
    const before = s.cores.length
    const restart = manager.restartCore()
    const core = await newCore(before, 12000)
    core?.stdout.write(LISTEN + DEFAULT)
    await restart
    await sleep(1500) // past the end of the slow clear and what follows it
    expect(manager.hasCoreProcess()).toBe(true)
    expect(s.resolver).toBe(true)
  }, 20000)

  it('removes the resolver when a slow set ends after a stop', async () => {
    s.tun = true
    s.slow = { action: 'set', ms: 4000 }
    await startAndListen()
    await manager.stopCore()
    await sleep(1500)
    expect(manager.hasCoreProcess()).toBe(false)
    expect(s.resolver).toBe(false)
  }, 20000)

  it('removes the resolver on a stop while macOS reports no network', async () => {
    net.isOnline = (): boolean => false
    await withFakeTimers(async () => {
      await manager.stopCore()
      expect(s.tool).toEqual(['clear'])
    })
  })

  it('does not start the tool again on the retries while offline', async () => {
    net.isOnline = (): boolean => false
    await withFakeTimers(async () => {
      await manager.stopCore()
      await vi.advanceTimersByTimeAsync(11000) // two turns of the 5 s retry
      expect(s.tool).toEqual(['clear'])
    })
  })

  // Last: an accepted quit cannot be undone in this module instance.
  it('does not set the resolver again when a quit is accepted during a start', async () => {
    s.tun = true
    let release!: () => void
    s.clearHold = new Promise<void>((r) => (release = r))
    const start = manager.startCore()
    await sleep(100) // held in the stop's clear
    beginShutdown()
    release()
    await expect(start).rejects.toThrow()
    expect(s.tool).not.toContain('set')
  })
})
