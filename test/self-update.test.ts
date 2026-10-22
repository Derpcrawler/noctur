import { describe, expect, it } from 'vitest'
import { execFile, spawn, spawnSync } from 'child_process'
import { createHash } from 'crypto'
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { createServer } from 'http'
import { AddressInfo } from 'net'
import { tmpdir } from 'os'
import path from 'path'
import {
  appleScriptFor,
  ChecksumError,
  downloadVerified,
  macInstallScript,
  pickRelease,
  Release,
  shQuote,
  winHelperScript
} from '../src/main/noctur/update'

const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex')

function release(tag: string): Release {
  return {
    tag_name: tag,
    html_url: `https://github.com/Derpcrawler/noctur/releases/tag/${tag}`,
    body: 'notes',
    assets: [
      {
        name: `Noctur_${tag.replace(/^v/, '')}_arm64.pkg`,
        browser_download_url: 'https://example.invalid/pkg',
        digest: `sha256:${'a'.repeat(64)}`,
        size: 1
      }
    ]
  }
}

describe('self-update', () => {
  // Koala Clash offered any release whose version differed from the installed one, so an older
  // latest release (a re-published or rolled-back tag) would be installed over a newer app.
  it('does not offer a release older than the installed version', () => {
    expect(pickRelease(release('v1.0.9'), '1.1.0', 'darwin', 'arm64')).toBeUndefined()
    expect(pickRelease(release('v1.2.0'), '1.1.0', 'darwin', 'arm64')?.file?.name).toBe(
      'Noctur_1.2.0_arm64.pkg'
    )
  })

  // A download that does not match the SHA-256 GitHub reports for the file (a truncated or
  // altered download) must not be kept for installing.
  it('rejects and removes a download whose checksum does not match', async () => {
    const body = Buffer.from('not the installer GitHub described')
    const server = createServer((_req, res) => {
      res.setHeader('content-length', body.length)
      res.end(body)
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/Noctur_1.2.0_arm64.pkg`
    const dest = path.join(mkdtempSync(path.join(tmpdir(), 'noctur-upd-')), 'update.pkg')
    try {
      await expect(
        downloadVerified(
          { url, sha256: sha('the real installer'), size: body.length },
          dest,
          false,
          () => {}
        )
      ).rejects.toBeInstanceOf(ChecksumError)
      expect(existsSync(dest)).toBe(false)
    } finally {
      server.close()
    }
  })
})

// The install script as the app runs it through osascript, without administrator rights and with a
// stand-in for installer(8).
describe.runIf(process.platform === 'darwin')('self-update install script (macOS)', () => {
  function setup(): {
    pkg: string
    installer: string
    installed: string
    marker: string
    flag: string
    flagSeen: string
  } {
    const dir = mkdtempSync(path.join(tmpdir(), "noctur upd's "))
    const pkg = path.join(dir, "Noctur update's file.pkg")
    writeFileSync(pkg, 'package bytes')
    const installed = path.join(dir, 'installed')
    const installer = path.join(dir, 'fake installer')
    const flag = path.join(dir, 'self-update flag')
    const flagSeen = path.join(dir, 'flag seen')
    writeFileSync(
      installer,
      `#!/bin/sh\n[ -f ${shQuote(flag)} ] && /usr/bin/touch ${shQuote(flagSeen)}\n/bin/sleep 0.3\n/bin/cat "$2" > ${shQuote(installed)}\n`
    )
    chmodSync(installer, 0o755)
    return { pkg, installer, installed, marker: path.join(dir, '.installing'), flag, flagSeen }
  }

  function run(script: string): Promise<string> {
    return new Promise((resolve) =>
      execFile('/usr/bin/osascript', ['-e', appleScriptFor(script, false)], (err, _o, stderr) =>
        resolve(err ? stderr : '')
      )
    )
  }

  // Koala Clash escaped only the first space in the package path, so the install command broke
  // for a path with more spaces, and a quote in it ended the AppleScript string. The install also
  // has to finish inside the privileged call: a background process left to install after the app
  // quit did not survive its end (owner's test, 2026-10-11).
  it('installs the package from a path with spaces and an apostrophe before returning', async () => {
    const s = setup()
    const err = await run(
      macInstallScript({
        pkg: s.pkg,
        sha256: sha('package bytes'),
        marker: s.marker,
        installer: s.installer
      })
    )
    expect(err).toBe('')
    expect(readFileSync(s.installed, 'utf8')).toBe('package bytes')
    expect(existsSync(s.marker)).toBe(true)
  })

  // The package's scripts quit and reopen a running Noctur on a manual install; during a self-update
  // they must not (the app restarts itself), so the flag they check exists while installer(8) runs.
  it('marks the install as a self-update while installer runs, then clears it', async () => {
    const s = setup()
    const err = await run(
      macInstallScript({
        pkg: s.pkg,
        sha256: sha('package bytes'),
        marker: s.marker,
        installer: s.installer,
        selfUpdateFlag: s.flag
      })
    )
    expect(err).toBe('')
    expect(existsSync(s.flagSeen)).toBe(true)
    expect(existsSync(s.flag)).toBe(false)
  })

  // The package is checked again after it is copied where only root can write, so a file changed
  // after the download check is not installed; the app reads exit code 12 from osascript's message.
  it('does not install a copy whose checksum does not match', async () => {
    const s = setup()
    const err = await run(
      macInstallScript({
        pkg: s.pkg,
        sha256: sha('what GitHub listed'),
        marker: s.marker,
        installer: s.installer
      })
    )
    expect(err).toMatch(/\(12\)\s*$/)
    expect(existsSync(s.installed)).toBe(false)
  })
})

// The Windows helper as the app passes it to PowerShell with -Command, with shell scripts standing in
// for the installer and the app. Runs where PowerShell 7 is installed (`pwsh` on PATH, or PWSH).
const pwsh = process.env.PWSH || 'pwsh'
const hasPwsh =
  process.platform !== 'win32' && spawnSync(pwsh, ['-NoProfile', '-Command', 'exit 0']).status === 0

describe.runIf(hasPwsh)('self-update helper script (Windows)', () => {
  function standIn(dir: string, name: string, out: string): string {
    const file = path.join(dir, name)
    writeFileSync(file, `#!/bin/sh\necho "$@" > ${shQuote(out)}\n`)
    chmodSync(file, 0o755)
    return file
  }

  // The app has exited by the time the helper runs; a finished process stands in for it.
  async function runHelper(installer: string, appExe: string): Promise<void> {
    const app = spawn('/usr/bin/true')
    await new Promise((resolve) => app.on('exit', resolve))
    await new Promise<void>((resolve, reject) =>
      execFile(
        pwsh,
        ['-NoProfile', '-NonInteractive', '-Command', winHelperScript(installer, appExe, app.pid!)],
        (err, _o, stderr) => (err ? reject(new Error(stderr)) : resolve())
      )
    )
  }

  // Start-Process returns without waiting for the started program.
  async function waitFor(file: string): Promise<string> {
    for (let i = 0; i < 50 && !existsSync(file); i++) await new Promise((r) => setTimeout(r, 100))
    return readFileSync(file, 'utf8').trim()
  }

  it('starts the installer silently with the update arguments', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "noctur upd's "))
    const installer = standIn(dir, "Noctur's setup.exe", path.join(dir, 'installer ran'))
    const appExe = standIn(dir, 'Noctur.exe', path.join(dir, 'app ran'))
    await runHelper(installer, appExe)
    expect(await waitFor(path.join(dir, 'installer ran'))).toBe('/S --updated --force-run')
    expect(existsSync(path.join(dir, 'app ran'))).toBe(false)
  }, 20000)

  it('opens the current version again when the installer cannot start', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "noctur upd's "))
    const appExe = standIn(dir, 'Noctur.exe', path.join(dir, 'app ran'))
    await runHelper(path.join(dir, 'missing setup.exe'), appExe)
    expect(await waitFor(path.join(dir, 'app ran'))).toBe('')
  }, 20000)
})
