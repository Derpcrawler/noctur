// Quitting turns the system proxy off before the app exits: the exit waits for the real
// sys/sysproxy.ts queue to finish turning it off, also behind an earlier proxy change still in
// progress, while the computer is offline, and when stopping the core fails. A step that never
// finishes delays the exit only up to the time limit, and the core is killed before that exit.
// Only the calls that would change the OS proxy are replaced; they are held and recorded.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'

const s = vi.hoisted(() => ({
  online: true,
  ops: [] as string[],
  holds: {} as Record<string, Promise<void> | undefined>,
  config: { sysProxy: { enable: true, mode: 'manual', settingMode: 'service' } } as Record<string, unknown>
}))

vi.mock('electron', async () => {
  const stub = await vi.importActual<typeof import('./mocks/electron')>('./mocks/electron')
  return { ...stub, net: { isOnline: () => s.online } }
})
vi.mock('../src/main/config', () => ({
  getAppConfig: async () => s.config,
  getControledMihomoConfig: async () => ({ 'mixed-port': 7897 })
}))
vi.mock('../src/main/core/factory', () => ({ getMixedPort: async () => 7897 }))
vi.mock('../src/main/utils/dirs', () => ({
  logPath: () => join(tmpdir(), 'noctur-shutdown-test.log'),
  servicePath: () => '/nonexistent'
}))
vi.mock('../src/main/service/api', () => ({
  setProxy: async () => {
    s.ops.push('enable-start')
    await s.holds.enable
    s.ops.push('enable-done')
  },
  setPac: async () => {},
  disableProxy: async () => {
    s.ops.push('disable-start')
    await s.holds.disable
    s.ops.push('disable-done')
  }
}))
vi.mock('../src/main/resolve/server', () => ({ pacPort: 0, startPacServer: async () => {}, stopPacServer: async () => {} }))
vi.mock('../src/main/utils/i18n', () => ({ t: (k: string) => k }))

const { triggerSysProxy } = await import('../src/main/sys/sysproxy')
const { shutdownAndExit } = await import('../src/main/noctur/shutdown-sequence')

function hold(name: string): () => void {
  let release!: () => void
  s.holds[name] = new Promise((r) => (release = r))
  return release
}
const tick = (ms = 20): Promise<void> => new Promise((r) => setTimeout(r, ms))

function steps(overrides: { stopCore?: () => Promise<void>; limitMs?: number } = {}): {
  done: Promise<void>
  logs: string[]
} {
  const logs: string[] = []
  const done = shutdownAndExit({
    disableSystemProxy: () => triggerSysProxy(false, false),
    stopCore:
      overrides.stopCore ??
      (async (): Promise<void> => {
        s.ops.push('core-stopped')
      }),
    killCore: async () => {
      s.ops.push('kill')
    },
    exit: () => s.ops.push('exit'),
    log: (line) => logs.push(line),
    limitMs: overrides.limitMs ?? 2000
  })
  return { done, logs }
}

beforeEach(() => {
  s.ops = []
  s.holds = {}
  s.online = true
})

describe.runIf(process.platform === 'darwin')('quit and the system proxy', () => {
  it('exits only after the system proxy is off', async () => {
    const release = hold('disable')
    const { done } = steps()
    await tick()
    try {
      expect(s.ops.slice().sort()).toEqual(['core-stopped', 'disable-start'])
    } finally {
      release()
    }
    await done
    expect(s.ops.slice(-3)).toEqual(['disable-done', 'kill', 'exit'])
  })

  it('waits behind an earlier proxy change still in progress', async () => {
    const releaseEnable = hold('enable')
    void triggerSysProxy(true, false)
    await tick()
    const { done } = steps()
    await tick()
    expect(s.ops).not.toContain('exit')
    releaseEnable()
    await done
    expect(s.ops.indexOf('disable-done')).toBeLessThan(s.ops.indexOf('exit'))
    expect(s.ops.indexOf('enable-done')).toBeLessThan(s.ops.indexOf('disable-start'))
  })

  it('still turns the proxy off when stopping the core fails', async () => {
    const { done, logs } = steps({
      stopCore: async () => {
        throw new Error('core did not stop')
      }
    })
    await done
    expect(s.ops).toEqual(['disable-start', 'disable-done', 'kill', 'exit'])
    expect(logs.join('')).toMatch(/stopping the core failed/)
  })

  it('exits at the time limit when turning the proxy off never finishes', async () => {
    const release = hold('disable')
    const started = Date.now()
    const { done, logs } = steps({ limitMs: 150 })
    await done
    release() // let the shared queue move on for the next test
    expect(s.ops.slice().sort()).toEqual(['core-stopped', 'disable-start', 'exit', 'kill'])
    expect(s.ops.slice(-2)).toEqual(['kill', 'exit'])
    expect(Date.now() - started).toBeGreaterThanOrEqual(140)
    expect(logs.join('')).toMatch(/not finished after 150 ms/)
  })

  it('turns the proxy off while the computer is offline', async () => {
    s.online = false
    const { done } = steps()
    await done
    expect(s.ops).toContain('disable-done')
    expect(s.ops.indexOf('disable-done')).toBeLessThan(s.ops.indexOf('exit'))
  })
})

// Last in this file: an accepted quit is permanent for the rest of the process.
describe.runIf(process.platform === 'darwin')('enable requests after a quit is accepted', () => {
  it('are refused, so the system proxy stays off at exit', async () => {
    const { beginShutdown } = await import('../src/main/sys/shutdown')
    beginShutdown()
    const { done } = steps()
    void triggerSysProxy(true, false) // from the tray, a shortcut or a start still running
    await done
    await tick()
    expect(s.ops).not.toContain('enable-start')
    expect(s.ops).toContain('disable-done')
  })
})

