// Revoking core permissions on Linux removes every capability a core has, also an incomplete set
// (for example only cap_net_admin), checks afterwards that none is left, and reports an error
// instead of success when they cannot be read or are still there. The status check shows an
// incomplete set as such. The real core manager and capability helpers run; getcap and
// pkexec setcap are simulated with a table of each file's capabilities.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const s = vi.hoisted(() => ({
  caps: {} as Record<string, string>,
  calls: [] as string[][],
  removeWorks: true,
  getcapFails: false,
  dir: ''
}))

vi.mock('child_process', async (orig) => {
  const real = await orig<typeof import('child_process')>()
  const { promisify } = await import('util')
  const run = async (file: string, args: string[]): Promise<{ stdout: string; stderr: string }> => {
    s.calls.push([file, ...args])
    if (file.endsWith('getcap')) {
      if (s.getcapFails) throw new Error('getcap: cannot read')
      const p = args[0]
      return { stdout: s.caps[p] ? `${p} ${s.caps[p]}\n` : '', stderr: '' }
    }
    if (file === 'pkexec') {
      // pkexec <setcap> -r <file> [-r <file> ...]
      for (let i = 1; i < args.length; i += 2) if (args[i] === '-r' && s.removeWorks) delete s.caps[args[i + 1]]
      return { stdout: '', stderr: '' }
    }
    throw new Error(`unexpected ${file}`)
  }
  const execFile = Object.assign(
    (file: string, args: string[], ...rest: unknown[]) => {
      const cb = rest.at(-1) as (e: Error | null, out?: string, err?: string) => void
      run(file, args).then((r) => cb(null, r.stdout, r.stderr), (e) => cb(e))
    },
    { [promisify.custom]: run }
  )
  return { ...real, execFile }
})
vi.mock('fs', async (orig) => {
  const real = await orig<typeof import('fs')>()
  // getcap and setcap live in /usr/sbin on Linux; the test host may not have them.
  const existsSync = (p: string): boolean => p === '/usr/sbin/getcap' || p === '/usr/sbin/setcap' || real.existsSync(p)
  return { ...real, existsSync, default: { ...real, existsSync } }
})
vi.mock('../src/main/index', () => ({ mainWindow: null, showError: () => {} }))
vi.mock('../src/main/config', () => ({
  getAppConfig: async () => ({}),
  patchAppConfig: async () => {},
  getControledMihomoConfig: async () => ({}),
  patchControledMihomoConfig: async () => {},
  getProfileConfig: async () => ({}),
  getAppConfigSync: () => ({})
}))
vi.mock('../src/main/core/factory', () => ({ generateProfile: async () => ({}), getRuntimeConfig: async () => ({}) }))
vi.mock('../src/main/utils/dirs', () => ({
  mihomoCorePath: (core: string) => join(s.dir, core),
  dataDir: () => s.dir,
  logPath: () => join(s.dir, 'test.log')
}))
vi.mock('../src/main/core/mihomoApi', () => ({}))
vi.mock('../src/main/sys/sysproxy', () => ({ triggerSysProxy: async () => {}, disableSysProxy: async () => {} }))
vi.mock('../src/main/service/api', () => ({ setSysDns: async () => {} }))
vi.mock('../src/main/utils/i18n', () => ({ t: (k: string) => k }))

const realPlatform = process.platform

beforeEach(() => {
  vi.resetModules()
  Object.defineProperty(process, 'platform', { value: 'linux' })
  s.dir = mkdtempSync(join(tmpdir(), 'noctur-revoke-'))
  writeFileSync(join(s.dir, 'mihomo'), '')
  s.caps = {}
  s.calls = []
  s.removeWorks = true
  s.getcapFails = false
})

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: realPlatform })
  rmSync(s.dir, { recursive: true, force: true })
})

const core = (name: string): string => join(s.dir, name)
const setcapCalls = (): string[][] => s.calls.filter((c) => c[0] === 'pkexec')

describe('Linux core permission revoke', () => {
  it('removes an incomplete set and leaves nothing behind', async () => {
    s.caps[core('mihomo')] = 'cap_net_admin=ep'
    const { revokeCorePermission } = await import('../src/main/core/manager')
    await revokeCorePermission()
    expect(setcapCalls()).toEqual([['pkexec', '/usr/sbin/setcap', '-r', core('mihomo')]])
    expect(s.caps).toEqual({})
  })

  it('reports an error when capabilities are still set afterwards', async () => {
    s.caps[core('mihomo')] = 'cap_net_bind_service,cap_net_admin=ep'
    s.removeWorks = false
    const { revokeCorePermission } = await import('../src/main/core/manager')
    await expect(revokeCorePermission()).rejects.toThrow(/still set/)
  })

  it('reports an error instead of success when capabilities cannot be read', async () => {
    s.getcapFails = true
    const { revokeCorePermission } = await import('../src/main/core/manager')
    await expect(revokeCorePermission()).rejects.toThrow()
    expect(setcapCalls()).toEqual([])
  })

  it('shows an incomplete set as incomplete, not as unauthorized', async () => {
    s.caps[core('mihomo')] = 'cap_net_admin=ep'
    const { checkCorePermission } = await import('../src/main/core/manager')
    expect(await checkCorePermission()).toEqual({ mihomo: 'partial' })
  })
})
