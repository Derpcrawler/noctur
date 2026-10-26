// Wake recovery re-applies the system proxy, but never after a newer change such as a Disconnect
// while it waits on the core, and only an accepted quit (not a cancelled prompt) stops it. The real
// sys/sysproxy.ts runs here; only the calls that would change the OS proxy are replaced and
// recorded.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'

const s = vi.hoisted(() => ({
  ops: [] as string[],
  config: { proxyMode: true, sysProxy: { enable: true, mode: 'manual', settingMode: 'service' } } as Record<string, unknown>,
  gate: null as null | Promise<void>
}))

vi.mock('../src/main/config', () => ({
  getAppConfig: async () => s.config,
  getControledMihomoConfig: async () => ({ tun: { enable: false }, 'mixed-port': 7897 })
}))
vi.mock('../src/main/core/factory', () => ({ getMixedPort: async () => 7897 }))
vi.mock('../src/main/core/manager', () => ({
  hasCoreProcess: () => true,
  restartCore: async () => {
    s.ops.push('restart')
  }
}))
vi.mock('../src/main/core/mihomoApi', () => ({
  mihomoVersion: async () => {
    if (s.gate) await s.gate
    return { version: 'test' }
  },
  mihomoHotReloadConfig: async () => {
    s.ops.push('reload')
  }
}))
vi.mock('../src/main/utils/dirs', () => ({
  logPath: () => join(tmpdir(), 'noctur-resume-test.log'),
  servicePath: () => '/nonexistent'
}))
vi.mock('../src/main/service/api', () => ({
  setProxy: async () => {
    s.ops.push('enable')
  },
  setPac: async () => {
    s.ops.push('enable')
  },
  disableProxy: async () => {
    s.ops.push('disable')
  }
}))
vi.mock('../src/main/resolve/server', () => ({ pacPort: 0, startPacServer: async () => {}, stopPacServer: async () => {} }))
vi.mock('../src/main/utils/i18n', () => ({ t: (k: string) => k }))

const { recoverAfterResume } = await import('../src/main/sys/resume')
const { createQuitFlow } = await import('../src/main/sys/quit-flow')
const { triggerSysProxy } = await import('../src/main/sys/sysproxy')

// Holds the core health check until release() is called.
function holdHealthCheck(): () => void {
  let release!: () => void
  s.gate = new Promise((r) => (release = r))
  return release
}
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 20))

beforeEach(() => {
  s.ops = []
  s.gate = null
  s.config = { proxyMode: true, sysProxy: { enable: true, mode: 'manual', settingMode: 'service' } }
})

describe.runIf(process.platform === 'darwin')('wake recovery', () => {
  it('re-applies the system proxy when nothing changed during recovery', async () => {
    await recoverAfterResume(0)
    expect(s.ops).toEqual(['reload', 'enable'])
  })

  it('does not switch the system proxy back on after a Disconnect during recovery', async () => {
    const release = holdHealthCheck()
    const recovery = recoverAfterResume(0)
    await tick() // recovery has read proxyMode=true and waits on the core
    // Home's Disconnect: system proxy off first, then proxyMode saved as false.
    await triggerSysProxy(false, false)
    s.config = { ...s.config, proxyMode: false }
    release()
    await recovery
    expect(s.ops).toEqual(['disable', 'reload'])
    expect(s.ops.lastIndexOf('enable')).toBe(-1)
  })

  // the quit prompt can be cancelled, so only an accepted quit may stop recovery. These go
  // through the production before-quit decision (sys/quit-flow.ts).
  it('still recovers after a cancelled quit prompt', async () => {
    const flow = createQuitFlow({ confirm: async () => false, shutdown: async () => {}, now: () => 10_000 })
    const prevented = vi.fn()
    await flow.onBeforeQuit({ preventDefault: prevented })
    expect(prevented).toHaveBeenCalled()
    await recoverAfterResume(0)
    expect(s.ops).toEqual(['reload', 'enable'])
  })

  it('still recovers after several cancelled quit prompts', async () => {
    let t = 20_000
    const flow = createQuitFlow({ confirm: async () => false, shutdown: async () => {}, now: () => (t += 1000) })
    for (let i = 0; i < 3; i++) await flow.onBeforeQuit({ preventDefault: () => {} })
    await recoverAfterResume(0)
    expect(s.ops).toEqual(['reload', 'enable'])
  })

  // Last: an accepted quit ends the session's recovery for good.
  it('stops when a quit is accepted while recovery waits on the core', async () => {
    const shutdown = vi.fn(async () => {})
    const flow = createQuitFlow({ confirm: async () => true, shutdown, now: () => 50_000 })
    const release = holdHealthCheck()
    const recovery = recoverAfterResume(0)
    await tick()
    await flow.onBeforeQuit({ preventDefault: () => {} })
    expect(shutdown).toHaveBeenCalledOnce()
    release()
    await recovery
    expect(s.ops).toEqual([])
  })
})
