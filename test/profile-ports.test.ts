// Ports follow the profile: the real generateProfile builds the core's config from a profile that
// declares its own mixed port. The profile's port is used unless the user set that port in
// Settings, and when a profile switch moves the mixed port while System Proxy is on, the system
// proxy is set again so it points at the new port.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const s = vi.hoisted(() => ({
  dir: '',
  profile: {} as Record<string, unknown>,
  appConfig: {} as Record<string, unknown>,
  proxyCalls: [] as boolean[]
}))

vi.mock('../src/main/config', () => ({
  getAppConfig: async () => s.appConfig,
  getControledMihomoConfig: async () => ({ 'mixed-port': 7897, 'socks-port': 0 }),
  getProfileConfig: async () => ({ current: 'p1' }),
  getProfile: async () => structuredClone(s.profile),
  getProfileStr: async () => ''
}))
vi.mock('../src/main/utils/dirs', () => ({
  mihomoProfileWorkDir: () => s.dir,
  mihomoWorkConfigPath: () => join(s.dir, 'config.yaml'),
  mihomoWorkDir: () => s.dir,
  rulePath: () => join(s.dir, 'no-rules.yaml')
}))
vi.mock('../src/main/sys/sysproxy', () => ({
  triggerSysProxy: async (enable: boolean) => {
    s.proxyCalls.push(enable)
  }
}))

const { generateProfile, getRuntimeConfig } = await import('../src/main/core/factory')

beforeEach(() => {
  s.dir = mkdtempSync(join(tmpdir(), 'noctur-ports-'))
  s.profile = { 'mixed-port': 7890, proxies: [] }
  s.appConfig = { proxyMode: true, sysProxy: { enable: true } }
  s.proxyCalls = []
})

describe('ports from the profile', () => {
  it('uses the mixed port the profile declares', async () => {
    await generateProfile()
    expect((await getRuntimeConfig())['mixed-port']).toBe(7890)
  })

  it('keeps the mixed port the user set in Settings', async () => {
    s.appConfig.customPorts = ['mixed-port']
    await generateProfile()
    expect((await getRuntimeConfig())['mixed-port']).toBe(7897)
  })

  it('sets the system proxy again when a profile switch moves the mixed port', async () => {
    await generateProfile()
    await generateProfile()
    s.proxyCalls = [] // the port may have moved since the previous test
    s.profile = { 'mixed-port': 7891, proxies: [] }
    await generateProfile()
    expect(s.proxyCalls).toEqual([true])
  })
})
