// A panel that does not list "noctur" in its Mihomo response rule (Remnawave by default) sends
// base64 node links to it and mihomo YAML only to User-Agents starting with "mihomo". Adding such a
// subscription must still work: the app asks again as "mihomo noctur/<version>" and saves that name
// on the profile. Runs the real download code against a local HTTP server; files go to a temporary
// folder and the core calls are recorded in memory.
import { createServer, Server } from 'http'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const s = vi.hoisted(() => ({ dir: '', agents: [] as string[] }))

vi.mock('../src/main/utils/dirs', () => ({
  profileConfigPath: () => `${s.dir}/profile.yaml`,
  profilePath: (id: string) => `${s.dir}/${id}.yaml`,
  mihomoProfileWorkDir: (id: string) => `${s.dir}/work-${id}`,
  mihomoWorkDir: () => `${s.dir}/work`,
  rulePath: (id: string) => `${s.dir}/rule-${id}.yaml`
}))
vi.mock('../src/main/config', () => ({ getAppConfig: async () => ({}) }))
vi.mock('../src/main/config/app', () => ({
  getAppConfig: async () => ({}),
  patchAppConfig: async () => {}
}))
vi.mock('../src/main/config/controledMihomo', () => ({
  getControledMihomoConfig: async () => ({}),
  patchControledMihomoConfig: async () => {}
}))
vi.mock('../src/main/core/manager', () => ({ restartCore: async () => {} }))
vi.mock('../src/main/core/factory', () => ({ getRuntimeConfig: async () => ({}) }))
vi.mock('../src/main/core/mihomoApi', () => ({
  mihomoHotReloadConfig: async () => {},
  patchMihomoConfig: async () => {}
}))
vi.mock('../src/main/index', () => ({ mainWindow: null }))
vi.mock('../src/main/resolve/theme', () => ({ downloadCustomCss: async () => undefined }))
vi.mock('../src/main/utils/i18n', () => ({ t: (k: string) => k }))

import { addProfileItem, getProfileConfig } from '../src/main/config/profile'
import { isDue } from '../src/main/core/profileUpdater'

let server: Server
let url = ''

beforeAll(async () => {
  s.dir = mkdtempSync(join(tmpdir(), 'noctur-sub-'))
  writeFileSync(join(s.dir, 'profile.yaml'), 'items: []\n')
  server = createServer((req, res) => {
    const agent = req.headers['user-agent'] ?? ''
    s.agents.push(agent)
    res.setHeader('content-type', 'text/plain')
    const interval = new URL(req.url ?? '/', 'http://x').searchParams.get('interval')
    if (interval) res.setHeader('profile-update-interval', interval)
    res.end(
      agent.startsWith('mihomo')
        ? 'proxies:\n  - { name: a, type: socks5, server: 127.0.0.1, port: 1080 }\n'
        : Buffer.from('vless://00000000-0000-0000-0000-000000000000@example.com:443#a').toString(
            'base64'
          )
    )
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const address = server.address()
  if (address && typeof address === 'object') url = `http://127.0.0.1:${address.port}/sub`
})

afterAll(() => {
  server.close()
  rmSync(s.dir, { recursive: true, force: true })
})

describe('subscription User-Agent', () => {
  it('adds a profile from a panel that sends YAML only to "mihomo" names', async () => {
    await addProfileItem({ type: 'remote', url })
    const [item] = (await getProfileConfig(true)).items
    expect(item.agent).toBe('mihomo')
    expect(readFileSync(join(s.dir, `${item.id}.yaml`), 'utf8')).toContain('proxies:')
    expect(s.agents.map((a) => a.split(' ')[0].split('/')[0])).toEqual(['noctur', 'mihomo'])
  })
})

// A profile-update-interval header that is negative, unreadable, tiny or huge is ignored and does
// not replace the interval the user set.
describe('profile-update-interval from the panel', () => {
  it.each(['-1', 'abc', '0.02', '1e300', '0'])('ignores %s', async (value) => {
    const withInterval = `${url}?interval=${value}`
    await addProfileItem({ type: 'remote', url: withInterval, interval: 120 })
    const item = (await getProfileConfig(true)).items.find((i) => i.url === withInterval)
    expect(item?.interval).toBe(120)
    expect(item?.locked).toBeFalsy()
  })

  it('is not due when the saved interval is negative', () => {
    const item = { id: 'a', type: 'remote', interval: -60, updated: Date.now() } as ProfileItem
    expect(isDue(item)).toBe(false)
  })
})
