// mihomo applies the top-level hosts list even with dns.use-hosts off, so turning hosts off in DNS
// settings has to remove the saved list. Runs the real patch code on a temporary config file.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const s = vi.hoisted(() => ({ dir: '' }))

vi.mock('../src/main/utils/dirs', () => ({
  controledMihomoConfigPath: () => `${s.dir}/mihomo.yaml`
}))
vi.mock('../src/main/config/app', () => ({
  getAppConfig: async () => ({ controlDns: true, controlSniff: true, controlTun: true })
}))
vi.mock('../src/main/core/factory', () => ({
  generateProfile: async () => ({ logLevel: 'info' })
}))

import { patchControledMihomoConfig } from '../src/main/config/controledMihomo'

beforeAll(() => {
  s.dir = mkdtempSync(join(tmpdir(), 'noctur-hosts-'))
  writeFileSync(
    join(s.dir, 'mihomo.yaml'),
    'dns:\n  ipv6: true\n  use-hosts: true\nsniffer:\n  enable: true\nhosts:\n  example.com: 127.0.0.1\n'
  )
})

afterAll(() => {
  rmSync(s.dir, { recursive: true, force: true })
})

describe('DNS settings: hosts off', () => {
  it('removes the saved hosts list', async () => {
    await patchControledMihomoConfig({ dns: { 'use-hosts': false } } as Partial<MihomoConfig>)
    const saved = readFileSync(join(s.dir, 'mihomo.yaml'), 'utf8')
    expect(saved).not.toContain('example.com')
  })
})
