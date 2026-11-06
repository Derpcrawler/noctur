// config/app.ts with real files in a temporary folder: a primary config that cannot be read or
// parsed falls back to the backup, a save never replaces a good backup with a broken file, and the
// config files are owner-only (0600), since the config holds the service's private signing key in
// plain text.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const paths = vi.hoisted(() => ({ config: '' }))
vi.mock('../src/main/utils/dirs', () => ({ appConfigPath: () => paths.config }))

const { getAppConfig, getAppConfigSync, patchAppConfig } = await import('../src/main/config/app')
const { defaultConfig } = await import('../src/main/utils/template')
const { parseYaml } = await import('../src/main/utils/yaml')

const GOOD_BACKUP = 'sysProxy:\n  enable: false\npalette: carina\nproxyMode: true\n'
const mode = (f: string): number => statSync(f).mode & 0o777
const onDisk = (f: string): Record<string, unknown> => parseYaml(readFileSync(f, 'utf8'))

let dir: string
let oldUmask: number
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'noctur-config-'))
  paths.config = join(dir, 'config.yaml')
  oldUmask = process.umask(0o022)
})
afterEach(() => {
  process.umask(oldUmask)
  rmSync(dir, { recursive: true, force: true })
})

describe('app config recovery', () => {
  const broken: [string, string][] = [
    ['malformed YAML', 'sysProxy: [\n'],
    ['an empty file', ''],
    ['valid YAML with the wrong shape', 'palette: void\n']
  ]
  for (const [name, primary] of broken) {
    it(`loads the backup when the primary is ${name}, and keeps it through a save`, async () => {
      writeFileSync(`${paths.config}.backup`, GOOD_BACKUP)
      writeFileSync(paths.config, primary)
      const cfg = await getAppConfig(true)
      expect(cfg.palette).toBe('carina')
      expect(cfg.proxyMode).toBe(true)

      await patchAppConfig({ navIcons: false })
      // The broken file never replaced the good backup; the new primary has the recovered settings.
      expect(onDisk(`${paths.config}.backup`).palette).toBe('carina')
      expect(onDisk(paths.config)).toMatchObject({ palette: 'carina', navIcons: false, proxyMode: true })
    })
  }

  it('loads the backup when the primary cannot be read', async () => {
    mkdirSync(paths.config) // reading a folder fails with EISDIR
    writeFileSync(`${paths.config}.backup`, GOOD_BACKUP)
    expect((await getAppConfig(true)).palette).toBe('carina')
  })

  it('the synchronous reader recovers the backup too', () => {
    writeFileSync(paths.config, 'sysProxy: [\n')
    writeFileSync(`${paths.config}.backup`, GOOD_BACKUP)
    expect(getAppConfigSync().palette).toBe('carina')
  })

  it('uses fresh defaults when both files are broken, without changing the defaults template', async () => {
    const before = JSON.stringify(defaultConfig)
    writeFileSync(paths.config, 'sysProxy: [\n')
    writeFileSync(`${paths.config}.backup`, '::')
    const cfg = await getAppConfig(true)
    expect(cfg.sysProxy).toEqual(defaultConfig.sysProxy)
    await patchAppConfig({ palette: 'helix', sysProxy: { enable: true } })
    expect(JSON.stringify(defaultConfig)).toBe(before)
  })

  it('still backs up a valid config before writing', async () => {
    writeFileSync(paths.config, GOOD_BACKUP)
    await getAppConfig(true)
    await patchAppConfig({ palette: 'crab' })
    expect(onDisk(`${paths.config}.backup`).palette).toBe('carina')
    expect(onDisk(paths.config).palette).toBe('crab')
  })
})

describe.runIf(process.platform !== 'win32')('app config file modes', () => {
  it('writes the config and its backup owner-only under umask 022', async () => {
    writeFileSync(paths.config, GOOD_BACKUP)
    await getAppConfig(true)
    await patchAppConfig({ serviceAuthKey: 'pub:priv-synthetic' })
    expect(mode(paths.config)).toBe(0o600)
    expect(mode(`${paths.config}.backup`)).toBe(0o600)
    expect(existsSync(`${paths.config}.tmp`)).toBe(false)
  })

  it('tightens files left 0644 by older versions when loading', async () => {
    writeFileSync(paths.config, GOOD_BACKUP, { mode: 0o644 })
    writeFileSync(`${paths.config}.backup`, GOOD_BACKUP, { mode: 0o644 })
    await getAppConfig(true)
    expect(mode(paths.config)).toBe(0o600)
    expect(mode(`${paths.config}.backup`)).toBe(0o600)
  })

  it('does not keep the mode of a leftover temp file', async () => {
    writeFileSync(paths.config, GOOD_BACKUP)
    writeFileSync(`${paths.config}.tmp`, 'old', { mode: 0o644 })
    await getAppConfig(true)
    await patchAppConfig({ palette: 'pine' })
    expect(mode(paths.config)).toBe(0o600)
  })
})
