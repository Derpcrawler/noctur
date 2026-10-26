// The launch migration keeps TUN on across restarts when "take over TUN settings" is off
// (controlTun: false); the app still controls tun.enable in that mode. A port saved before ports
// followed the profile stays the user's when it is not the default.
import { describe, expect, it, vi } from 'vitest'

const s = vi.hoisted(() => ({
  mihomoPatches: [] as unknown[],
  appPatches: [] as unknown[],
  mihomo: {} as Record<string, unknown>
}))

vi.mock('../src/main/config', async () => {
  const { defaultConfig, defaultControledMihomoConfig } = await import('../src/main/utils/template')
  return {
    getAppConfig: async () => ({ ...structuredClone(defaultConfig), controlTun: false }),
    getControledMihomoConfig: async () => ({
      ...structuredClone(defaultControledMihomoConfig),
      tun: { enable: true },
      ...s.mihomo
    }),
    patchControledMihomoConfig: async (p: unknown) => {
      s.mihomoPatches.push(p)
    },
    patchAppConfig: async (p: unknown) => {
      s.appPatches.push(p)
    },
    getProfileConfig: async () => ({})
  }
})
vi.mock('../src/main/core/manager', () => ({ startNetworkDetection: async () => {} }))
vi.mock('../src/main/sys/resume', () => ({ initResumeRecovery: () => {} }))
vi.mock('../src/main/service/manager', () => ({ initKeyManager: async () => {} }))
vi.mock('../src/main/sys/sysproxy', () => ({ triggerSysProxy: async () => {} }))
vi.mock('../src/main/resolve/server', () => ({ startPacServer: async () => {}, stopPacServer: async () => {} }))
vi.mock('../src/main/sys/ssid', () => ({ startSSIDCheck: async () => {} }))

const { migration } = await import('../src/main/utils/init')

describe('launch migration', () => {
  it('keeps TUN on across launches when controlTun is false', async () => {
    await migration()
    await migration()
    const tunPatches = s.mihomoPatches.filter((p) => (p as { tun?: unknown }).tun !== undefined)
    expect(tunPatches).toEqual([])
  })

  it('keeps a port the user changed as theirs, so the profile does not override it', async () => {
    s.mihomo = { 'mixed-port': 7000 }
    s.appPatches = []
    await migration()
    const ports = s.appPatches.map((p) => (p as { customPorts?: unknown }).customPorts).filter(Boolean)
    expect(ports).toEqual([['mixed-port']])
    s.mihomo = {}
  })
})
