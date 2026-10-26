// The macOS installer scripts (build/pkg-scripts) run against throwaway folders, fake processes and
// a fake networksetup: Astra Clash (the app's previous name) is quit and removed before Noctur is
// installed, through its own shutdown when it answers and by stopping it and turning off the system
// proxy it set when it does not; an app with another bundle id at that path stays; cores downloaded
// under the old name move to Noctur's folder, and a leftover old folder is removed. An alpha core in
// the installed bundle is removed.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ChildProcess, execSync, spawn, spawnSync } from 'child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'

const scripts = join(__dirname, '..', 'build', 'pkg-scripts')
let root: string, oldApp: string, log: string
const children: ChildProcess[] = []

function consoleHome(): string {
  const user = execSync('stat -f%Su /dev/console', { encoding: 'utf8' }).trim()
  return execSync(`dscl . -read "/Users/${user}" NFSHomeDirectory`, { encoding: 'utf8' })
    .split(' ')[1]
    .trim()
}

function script(path: string, body: string): void {
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
}

function oldAppBundle(bundleId: string): void {
  mkdirSync(join(oldApp, 'Contents', 'MacOS'), { recursive: true })
  mkdirSync(join(oldApp, 'Contents', 'Resources', 'sidecar'), { recursive: true })
  writeFileSync(
    join(oldApp, 'Contents', 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${bundleId}</string></dict></plist>`
  )
  program(join(oldApp, 'Contents', 'MacOS', 'Astra Clash'))
  program(join(oldApp, 'Contents', 'Resources', 'sidecar', 'mihomo'))
}

// A stand-in program: a link to sleep, so the process's command line starts with this path, as a
// real app or core's does. (A copy of a system binary would be killed by code signing.)
function program(path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  symlinkSync('/bin/sleep', path)
}

function start(path: string): ChildProcess {
  const child = spawn(path, ['300'], { stdio: 'ignore', detached: true })
  children.push(child)
  return child
}

function startOldApp(): ChildProcess[] {
  return [
    start(join(oldApp, 'Contents', 'MacOS', 'Astra Clash')),
    start(join(oldApp, 'Contents', 'Resources', 'sidecar', 'mihomo'))
  ]
}

function runStatus(name: string, env: Record<string, string> = {}): number | null {
  const r = spawnSync('/bin/sh', [join(scripts, name)], {
    env: { ...process.env, NOCTUR_PKG_ROOT: root, NOCTUR_PKG_QUIT_WAIT: '2', ...env },
    encoding: 'utf8',
    timeout: 30_000
  })
  return r.status
}

function run(name: string, env: Record<string, string> = {}): void {
  expect(runStatus(name, env)).toBe(0)
}

const support = (name: string): string => join(root, 'Library', 'Application Support', name)

const alive = (child: ChildProcess): boolean => child.exitCode === null && child.signalCode === null

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'noctur-pkg-'))
  oldApp = join(root, 'Applications', 'Astra Clash.app')
  log = join(root, 'calls.log')
  writeFileSync(log, '')
  // Fake networksetup: one service whose web proxy points at the old app's port.
  script(
    join(root, 'networksetup'),
    `echo "$@" >> "${log}"
case "$1" in
  -listallnetworkservices) printf 'An asterisk (*) denotes that a network service is disabled.\\nWi-Fi\\n' ;;
  -getwebproxy) printf 'Enabled: Yes\\nServer: 127.0.0.1\\nPort: 7890\\n' ;;
  -getautoproxyurl) printf 'URL: (null)\\nEnabled: No\\n' ;;
esac`
  )
})

afterEach(() => {
  // Each stand-in leads its own process group; the group also holds a shell's sleep.
  for (const c of children.splice(0)) {
    try {
      if (c.pid) process.kill(-c.pid, 'SIGKILL')
    } catch {
      // already gone
    }
  }
  for (const d of [join(root, 'Library', 'Application Support'), support('Astra Clash')]) {
    if (existsSync(d)) chmodSync(d, 0o755)
  }
  rmSync(root, { recursive: true, force: true })
})

describe.skipIf(process.platform !== 'darwin')('macOS installer scripts', () => {
  // A manual install over a running Noctur left the old version running until it was restarted by
  // hand (owner, 2026-10-11): it is now quit before and opened again after.
  it('quits a running Noctur before a manual install and opens it again after', async () => {
    const exe = join(root, 'Applications', 'Noctur.app', 'Contents', 'MacOS', 'Noctur')
    program(exe)
    const app = start(exe)
    script(join(root, 'quit'), `echo "quit $1" >> "${log}"; pkill -f "${exe}"`)
    script(join(root, 'reopen'), `echo "reopen $1 $2" >> "${log}"`)
    const env = {
      NOCTUR_PKG_QUIT_REQUEST: join(root, 'quit'),
      NOCTUR_PKG_REOPEN: join(root, 'reopen')
    }
    run('preinstall', env)
    await new Promise((r) => setTimeout(r, 200))
    expect(alive(app)).toBe(false)
    runStatus('postinstall', env)
    const user = execSync('stat -f%Su /dev/console', { encoding: 'utf8' }).trim()
    expect(readFileSync(log, 'utf8')).toBe(
      `quit app.noctur.desktop\nreopen ${user} ${join(root, 'Applications', 'Noctur.app')}\n`
    )
  })

  // macOS ran preinstall twice in one installation (owner's test, 2026-10-11): the second run found
  // Noctur already gone, the first run's note was lost, and nothing opened Noctur again.
  it('opens Noctur again when preinstall runs twice in one installation', async () => {
    const exe = join(root, 'Applications', 'Noctur.app', 'Contents', 'MacOS', 'Noctur')
    program(exe)
    start(exe)
    script(join(root, 'quit'), `pkill -f "${exe}"`)
    script(join(root, 'reopen'), `echo "reopen $2" >> "${log}"`)
    const env = {
      NOCTUR_PKG_QUIT_REQUEST: join(root, 'quit'),
      NOCTUR_PKG_REOPEN: join(root, 'reopen')
    }
    run('preinstall', env)
    await new Promise((r) => setTimeout(r, 200))
    run('preinstall', env)
    runStatus('postinstall', env)
    runStatus('postinstall', env)
    expect(readFileSync(log, 'utf8')).toBe(`reopen ${join(root, 'Applications', 'Noctur.app')}\n`)
  })

  // During a self-update the app restarts itself; quitting it from the package scripts would end the
  // process that waits for the installer.
  it('leaves Noctur alone while a self-update is installing', async () => {
    const exe = join(root, 'Applications', 'Noctur.app', 'Contents', 'MacOS', 'Noctur')
    program(exe)
    const app = start(exe)
    const flag = join(root, 'noctur-self-update')
    writeFileSync(flag, '')
    script(join(root, 'quit'), `echo "quit $1" >> "${log}"; pkill -f "${exe}"`)
    script(join(root, 'reopen'), `echo "reopen $1 $2" >> "${log}"`)
    const env = {
      NOCTUR_PKG_SELF_UPDATE_FLAG: flag,
      NOCTUR_PKG_QUIT_REQUEST: join(root, 'quit'),
      NOCTUR_PKG_REOPEN: join(root, 'reopen')
    }
    run('preinstall', env)
    runStatus('postinstall', env)
    expect(alive(app)).toBe(true)
    expect(readFileSync(log, 'utf8')).toBe('')
  })

  it('quits a running Astra Clash through its own shutdown and removes it', async () => {
    oldAppBundle('app.astraclash')
    const [app, core] = startOldApp()
    // Answers the quit request the way the app's shutdown does: app and core exit.
    script(join(root, 'quit'), `echo "quit $1" >> "${log}"; pkill -f "${oldApp}/"`)
    run('preinstall', {
      NOCTUR_PKG_QUIT_REQUEST: join(root, 'quit'),
      NOCTUR_PKG_NETWORKSETUP: join(root, 'networksetup')
    })
    await new Promise((r) => setTimeout(r, 200))
    expect(readFileSync(log, 'utf8')).toBe('quit app.astraclash\n')
    expect(alive(app) || alive(core)).toBe(false)
    expect(existsSync(oldApp)).toBe(false)
  })

  it('stops an Astra Clash that does not quit and turns off the proxy it set', async () => {
    oldAppBundle('app.astraclash')
    const [app, core] = startOldApp()
    const config = join(root, consoleHome(), 'Library', 'Application Support', 'astra-clash')
    mkdirSync(config, { recursive: true })
    writeFileSync(join(config, 'config.yaml'), 'proxyMode: true\n')
    script(join(root, 'quit'), 'exit 0')
    run('preinstall', {
      NOCTUR_PKG_QUIT_REQUEST: join(root, 'quit'),
      NOCTUR_PKG_NETWORKSETUP: join(root, 'networksetup')
    })
    await new Promise((r) => setTimeout(r, 200))
    expect(alive(app) || alive(core)).toBe(false)
    const calls = readFileSync(log, 'utf8')
    expect(calls).toContain('-setwebproxystate Wi-Fi off')
    expect(calls).toContain('-setsecurewebproxystate Wi-Fi off')
    expect(calls).toContain('-setsocksfirewallproxystate Wi-Fi off')
    expect(existsSync(oldApp)).toBe(false)
  })

  it('leaves an app with another bundle id at that path', () => {
    oldAppBundle('com.example.other')
    run('preinstall', { NOCTUR_PKG_NETWORKSETUP: join(root, 'networksetup') })
    expect(existsSync(join(oldApp, 'Contents', 'Info.plist'))).toBe(true)
  })

  it('removes an alpha core left in the installed bundle, keeping the built-in core', () => {
    const sidecar = join(root, 'Applications', 'Noctur.app', 'Contents', 'Resources', 'sidecar')
    mkdirSync(sidecar, { recursive: true })
    writeFileSync(join(sidecar, 'mihomo'), 'core')
    writeFileSync(join(sidecar, 'mihomo-alpha'), 'alpha')
    chmodSync(join(sidecar, 'mihomo-alpha'), 0o4755)
    runStatus('postinstall')
    expect(existsSync(join(sidecar, 'mihomo-alpha'))).toBe(false)
    expect(readFileSync(join(sidecar, 'mihomo'), 'utf8')).toBe('core')
  })

  it('moves cores downloaded under the old name to Noctur, keeping their mode', () => {
    const oldCores = join(root, 'Library', 'Application Support', 'Astra Clash', 'cores')
    mkdirSync(oldCores, { recursive: true })
    writeFileSync(join(oldCores, 'mihomo-v1.19.32'), 'core')
    chmodSync(join(oldCores, 'mihomo-v1.19.32'), 0o4755)
    run('postinstall')
    const moved = join(root, 'Library', 'Application Support', 'Noctur', 'cores', 'mihomo-v1.19.32')
    expect(readFileSync(moved, 'utf8')).toBe('core')
    expect(statSync(moved).mode & 0o7777).toBe(0o4755)
    expect(existsSync(join(root, 'Library', 'Application Support', 'Astra Clash'))).toBe(false)
  })

  it('removes the old cores folder when Noctur already has one', () => {
    const oldCores = join(root, 'Library', 'Application Support', 'Astra Clash', 'cores')
    const newCores = join(root, 'Library', 'Application Support', 'Noctur', 'cores')
    mkdirSync(oldCores, { recursive: true })
    mkdirSync(newCores, { recursive: true })
    writeFileSync(join(oldCores, 'mihomo-v1.19.31'), 'old')
    writeFileSync(join(newCores, 'mihomo-v1.19.32'), 'new')
    run('postinstall')
    expect(existsSync(join(root, 'Library', 'Application Support', 'Astra Clash'))).toBe(false)
    expect(readFileSync(join(newCores, 'mihomo-v1.19.32'), 'utf8')).toBe('new')
    expect(existsSync(join(newCores, 'mihomo-v1.19.31'))).toBe(false)
  })

  it('stops a core downloaded in Astra Clash when the app does not quit', async () => {
    oldAppBundle('app.astraclash')
    const [app] = startOldApp()
    const downloaded = join(support('Astra Clash'), 'cores', 'mihomo-v1.19.32')
    program(downloaded)
    const core = start(downloaded)
    script(join(root, 'quit'), 'exit 0')
    run('preinstall', {
      NOCTUR_PKG_QUIT_REQUEST: join(root, 'quit'),
      NOCTUR_PKG_NETWORKSETUP: join(root, 'networksetup')
    })
    await new Promise((r) => setTimeout(r, 200))
    expect(alive(app)).toBe(false)
    expect(alive(core)).toBe(false)
  })

  it('stops cores that outlived Astra Clash, bundled or downloaded, and nothing else', async () => {
    oldAppBundle('app.astraclash')
    const bundled = start(join(oldApp, 'Contents', 'Resources', 'sidecar', 'mihomo'))
    const downloaded = join(support('Astra Clash'), 'cores', 'mihomo-v1.19.32')
    program(downloaded)
    const core = start(downloaded)
    // Mentions the cores folder only in its arguments.
    // (sh stays the process, so its command line keeps the path.)
    const bystander = spawn('/bin/sh', ['-c', 'sleep 300; :', downloaded], {
      stdio: 'ignore',
      detached: true
    })
    children.push(bystander)
    run('preinstall', { NOCTUR_PKG_NETWORKSETUP: join(root, 'networksetup') })
    await new Promise((r) => setTimeout(r, 200))
    expect(alive(bundled)).toBe(false)
    expect(alive(core)).toBe(false)
    expect(alive(bystander)).toBe(true)
  })

  it("keeps the old cores and reports failure when Noctur's folder cannot be made", () => {
    const oldCore = join(support('Astra Clash'), 'cores', 'mihomo-v1.19.32')
    mkdirSync(dirname(oldCore), { recursive: true })
    writeFileSync(oldCore, 'core')
    chmodSync(join(root, 'Library', 'Application Support'), 0o555)
    expect(runStatus('postinstall')).not.toBe(0)
    expect(readFileSync(oldCore, 'utf8')).toBe('core')
  })

  it.each([
    ['a link to another folder', 'Noctur', 'link'],
    ['a broken link', 'Noctur', 'dangling'],
    ['a file', 'Noctur', 'file'],
    ['a cores link to another folder', 'Noctur/cores', 'link']
  ])('refuses a Noctur folder that is %s and keeps the old cores', (_label, at, kind) => {
    const oldCore = join(support('Astra Clash'), 'cores', 'mihomo-v1.19.32')
    mkdirSync(dirname(oldCore), { recursive: true })
    writeFileSync(oldCore, 'core')
    const elsewhere = join(root, 'elsewhere')
    mkdirSync(elsewhere)
    const target = join(root, 'Library', 'Application Support', at)
    mkdirSync(dirname(target), { recursive: true })
    if (kind === 'link') symlinkSync(elsewhere, target)
    else if (kind === 'dangling') symlinkSync(join(root, 'missing'), target)
    else writeFileSync(target, '')
    expect(runStatus('postinstall')).not.toBe(0)
    expect(readFileSync(oldCore, 'utf8')).toBe('core')
    expect(readdirSync(elsewhere)).toEqual([])
    expect(existsSync(join(root, 'missing'))).toBe(false)
  })

  it('stops the installation and keeps Astra Clash when an old core keeps coming back', async () => {
    oldAppBundle('app.astraclash')
    const core = join(oldApp, 'Contents', 'Resources', 'sidecar', 'mihomo')
    // Restarts the core whenever it ends; its own command line does not start with the core's path.
    const keeper = spawn('/bin/sh', ['-c', `while :; do "${core}" 300; done`], {
      stdio: 'ignore',
      detached: true
    })
    children.push(keeper)
    await new Promise((r) => setTimeout(r, 300))
    expect(
      runStatus('preinstall', { NOCTUR_PKG_NETWORKSETUP: join(root, 'networksetup') })
    ).not.toBe(0)
    expect(existsSync(join(oldApp, 'Contents', 'Info.plist'))).toBe(true)
  })
})
