// On macOS the TUN sets the system DNS itself (tun.dns-mode native). mihomo's `system` nameserver
// reads /etc/resolv.conf, which then lists only the TUN's address; mihomo skips it, so `system` is left
// with no server and every name a profile sends there fails. The real generateProfile builds the
// core's config from a profile that uses `system`.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const s = vi.hoisted(() => ({
  dir: '',
  app: {} as Record<string, unknown>
}))

const profile = {
  proxies: [],
  tun: { enable: true, stack: 'mixed' },
  dns: {
    enable: true,
    'enhanced-mode': 'fake-ip',
    nameserver: ['https://1.1.1.1/dns-query', 'system'],
    'nameserver-policy': {
      '+.apple.com': 'system',
      '+.example.com': ['system://', 'https://8.8.8.8/dns-query'],
      '+.ru': ['https://77.88.8.8/dns-query']
    }
  }
}

vi.mock('../src/main/config', () => ({
  getAppConfig: async () => ({ proxyMode: false, controlDns: false, controlTun: false, ...s.app }),
  getControledMihomoConfig: async () => ({ tun: { enable: true } }),
  getProfileConfig: async () => ({ current: 'p1' }),
  getProfile: async () => structuredClone(profile),
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
  s.dir = mkdtempSync(join(tmpdir(), 'noctur-tun-dns-'))
  s.app = {}
})

describe.runIf(process.platform === 'darwin')('the TUN sets the macOS DNS', () => {
  it('replaces every system nameserver while it does', async () => {
    await generateProfile()
    const config = await getRuntimeConfig()
    expect(config.tun?.['dns-mode']).toBe('native')
    expect(JSON.stringify(config.dns)).not.toMatch(/system/i)
    expect(config.dns?.nameserver).toEqual(['https://1.1.1.1/dns-query', '77.88.8.8', '77.88.8.1'])
    expect(config.dns?.['nameserver-policy']).toEqual({
      '+.apple.com': ['77.88.8.8', '77.88.8.1'],
      '+.example.com': ['77.88.8.8', '77.88.8.1', 'https://8.8.8.8/dns-query'],
      '+.ru': ['https://77.88.8.8/dns-query']
    })
  })

  it('leaves the DNS to the profile when the setting is off', async () => {
    s.app = { autoSetDNSMode: 'none' }
    await generateProfile()
    const config = await getRuntimeConfig()
    expect(config.tun?.['dns-mode']).toBeUndefined()
    expect(config.dns?.['nameserver-policy']?.['+.apple.com']).toBe('system')
  })
})
