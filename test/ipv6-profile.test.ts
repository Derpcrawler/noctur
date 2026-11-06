// IPv6 comes from the profile: a saved IPv6 value in the core settings does not override it. The real
// generateProfile builds the core's config from a profile and from saved core settings holding such
// a value.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const s = vi.hoisted(() => ({
  dir: '',
  profile: {} as Record<string, unknown>,
  saved: {} as Record<string, unknown>
}))

vi.mock('../src/main/config', () => ({
  getAppConfig: async () => ({ proxyMode: false }),
  getControledMihomoConfig: async () => structuredClone(s.saved),
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
vi.mock('../src/main/sys/sysproxy', () => ({ triggerSysProxy: async () => undefined }))

const { generateProfile, getRuntimeConfig } = await import('../src/main/core/factory')

beforeEach(() => {
  s.dir = mkdtempSync(join(tmpdir(), 'noctur-ipv6-'))
})

describe('IPv6 from the profile', () => {
  it('ignores a saved IPv6 value in either direction', async () => {
    // The profile turns IPv6 off; the saved value is on.
    s.profile = { ipv6: false, proxies: [] }
    s.saved = { ipv6: true }
    await generateProfile()
    expect((await getRuntimeConfig()).ipv6).toBe(false)

    // A profile that leaves IPv6 to the core's default (on); the saved value is off.
    s.profile = { proxies: [] }
    s.saved = { ipv6: false }
    await generateProfile()
    expect((await getRuntimeConfig()).ipv6).toBeUndefined()
  })
})
