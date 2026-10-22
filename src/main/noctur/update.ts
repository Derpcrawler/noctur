// Noctur: self-update from the public repo's GitHub releases, replacing Koala Clash's updater.
// What changed from upstream, and why:
// - Only a newer version is offered (upstream offered any version that differed, older ones too).
//   GitHub's "latest release" never returns drafts or pre-releases.
// - The download is checked against the SHA-256 GitHub reports for the release file (as upstream).
// - macOS: one password prompt while the app is open; the package is copied into a folder only root
//   can write to, checked again there and installed, then the app restarts itself. Windows: the app
//   quits normally first (the core stops and the system proxy is reset), and a hidden helper starts
//   the installer (UAC), which opens the new version; if UAC is declined the helper opens the current
//   version again.
// - Other platforms and builds without a matching release file get a link to the release page.
import axios, { AxiosRequestConfig } from 'axios'
import { createHash } from 'crypto'
import { createWriteStream } from 'fs'
import { mkdir, rm } from 'fs/promises'
import path from 'path'
import { pipeline } from 'stream/promises'
import { Transform } from 'stream'

/** The public repo; NOCTUR_UPDATE_REPO and NOCTUR_UPDATE_API point a test build elsewhere. */
export const UPDATE_REPO = process.env.NOCTUR_UPDATE_REPO || 'Derpcrawler/noctur'
const API = process.env.NOCTUR_UPDATE_API || 'https://api.github.com'

export interface UpdateInfo {
  version: string
  changelog: string
  /** The release page, for "Download from GitHub". */
  page: string
  /** The installer for this platform; absent when there is none (the page link is offered). */
  file?: { name: string; url: string; sha256: string; size: number }
}

interface ReleaseAsset {
  name: string
  browser_download_url: string
  digest?: string | null
  size: number
}

export interface Release {
  tag_name: string
  html_url: string
  body?: string | null
  draft?: boolean
  prerelease?: boolean
  assets?: ReleaseAsset[]
}

/** Plain x.y.z versions, an optional leading "v". Anything else (pre-release tags) is not offered. */
function parseVersion(v: string): number[] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim())
  return m ? m.slice(1).map(Number) : null
}

export function isNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate)
  const b = parseVersion(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i]
  }
  return false
}

const INSTALLERS: Record<string, RegExp> = {
  'darwin-arm64': /^Noctur_[\d.]+_arm64\.pkg$/,
  'win32-x64': /^Noctur_[\d.]+_x64-setup\.exe$/
}

/** The update a release offers to this install, or undefined when it is not newer. */
export function pickRelease(
  release: Release,
  current: string,
  platform: string = process.platform,
  arch: string = process.arch
): UpdateInfo | undefined {
  if (release.draft || release.prerelease || !isNewer(release.tag_name, current)) return undefined
  const pattern = INSTALLERS[`${platform}-${arch}`]
  const asset = pattern && release.assets?.find((a) => pattern.test(a.name))
  const sha256 = /^sha256:([0-9a-f]{64})$/i.exec(asset?.digest ?? '')?.[1]?.toLowerCase()
  return {
    version: release.tag_name.replace(/^v/, ''),
    // The public notes end with an install section (file names, first-run steps), not shown in the app.
    changelog: (release.body ?? '').split(/^#{1,6}\s*Install\b.*$/m)[0].trim(),
    page: release.html_url,
    ...(asset &&
      sha256 && {
        file: { name: asset.name, url: asset.browser_download_url, sha256, size: asset.size }
      })
  }
}

export type ProxyConfig = AxiosRequestConfig['proxy']

/** Through Noctur's own proxy when there is one, and directly if that fails. */
async function withProxy<T>(
  proxy: ProxyConfig,
  run: (proxy: ProxyConfig) => Promise<T>
): Promise<T> {
  if (!proxy) return run(false)
  try {
    return await run(proxy)
  } catch (e) {
    if (axios.isCancel(e)) throw e
    return run(false)
  }
}

export async function fetchLatest(
  current: string,
  proxy: ProxyConfig
): Promise<UpdateInfo | undefined> {
  const res = await withProxy(proxy, (p) =>
    axios.get<Release>(`${API}/repos/${UPDATE_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      proxy: p,
      timeout: 15000
    })
  )
  return pickRelease(res.data, current)
}

export class ChecksumError extends Error {}

/**
 * Downloads `file` to `dest` and checks its SHA-256 while writing. On a mismatch, or any failure,
 * the partial file is removed.
 */
export async function downloadVerified(
  file: { url: string; sha256: string; size: number },
  dest: string,
  proxy: ProxyConfig,
  onProgress: (percent: number) => void,
  signal?: AbortSignal
): Promise<void> {
  await mkdir(path.dirname(dest), { recursive: true })
  try {
    await withProxy(proxy, async (p) => {
      const res = await axios.get(file.url, {
        responseType: 'stream',
        proxy: p,
        signal,
        timeout: 30000
      })
      const total = Number(res.headers['content-length']) || file.size || 0
      const hash = createHash('sha256')
      let done = 0
      let shown = -1
      const meter = new Transform({
        transform(chunk: Buffer, _enc, cb): void {
          hash.update(chunk)
          done += chunk.length
          const percent = total ? Math.min(100, Math.floor((done * 100) / total)) : 0
          if (percent !== shown) onProgress((shown = percent))
          cb(null, chunk)
        }
      })
      await pipeline(res.data, meter, createWriteStream(dest), { signal })
      if (hash.digest('hex') !== file.sha256) throw new ChecksumError(file.url)
    })
  } catch (e) {
    await rm(dest, { force: true })
    throw e
  }
}

/** A string as one sh word. */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/** Exit codes of the macOS install script: the copied package does not match; installer(8) failed. */
export const MAC_CHECKSUM_EXIT = 12
export const MAC_INSTALL_EXIT = 13

/**
 * macOS: the shell script run as root through `do shell script ... with administrator privileges`,
 * while the app is still open. It first creates `marker` (the app sees the password was accepted
 * and shows "Installing"), copies the package into a new folder only root can write to and checks
 * it there, so the file the user's account can change is not the one installed, then installs and
 * removes the copy. The app restarts itself afterwards. A background root process that waited for
 * the app to quit did not survive the end of the privileged call (owner's test, 2026-10-11).
 * `installer` is replaced in tests.
 */
export function macInstallScript(opts: {
  pkg: string
  sha256: string
  marker: string
  installer?: string
  selfUpdateFlag?: string
}): string {
  if (!/^[0-9a-f]{64}$/.test(opts.sha256)) throw new Error('bad sha256')
  const installer = opts.installer ?? '/usr/sbin/installer'
  // While it exists, the package's scripts leave the running app alone (build/pkg-scripts/preinstall):
  // a manual install quits and reopens Noctur, but here the app restarts itself.
  const flag = shQuote(opts.selfUpdateFlag ?? SELF_UPDATE_FLAG)
  return [
    `/usr/bin/touch ${shQuote(opts.marker)}`,
    'd=$(/usr/bin/mktemp -d /private/tmp/noctur-update.XXXXXX) || exit 10',
    `/bin/cp ${shQuote(opts.pkg)} "$d/update.pkg" || { /bin/rm -rf "$d"; exit 11; }`,
    `h=$(/usr/bin/shasum -a 256 "$d/update.pkg" | /usr/bin/cut -d' ' -f1)`,
    `[ "$h" = ${opts.sha256} ] || { /bin/rm -rf "$d"; exit ${MAC_CHECKSUM_EXIT}; }`,
    `/usr/bin/touch ${flag}`,
    `${shQuote(installer)} -pkg "$d/update.pkg" -target / >/dev/null || { /bin/rm -f ${flag}; /bin/rm -rf "$d"; exit ${MAC_INSTALL_EXIT}; }`,
    `/bin/rm -f ${flag}`,
    '/bin/rm -rf "$d"'
  ].join('\n')
}

/** Only root can write here; macOS empties it at restart. */
export const SELF_UPDATE_FLAG = '/private/var/run/noctur-self-update'

/** The AppleScript that runs `script` with /bin/sh, as root when `admin` is set. */
export function appleScriptFor(script: string, admin: boolean): string {
  const quoted = `/bin/sh -c ${shQuote(script)}`.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `do shell script "${quoted}"${admin ? ' with administrator privileges' : ''}`
}

/** A string as one PowerShell single-quoted literal. */
function psQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

/**
 * Windows: the hidden PowerShell helper. It waits for the app to exit, then starts the installer
 * silently; the installer asks for UAC and opens the new version when done (--force-run). If the
 * prompt is declined or the installer cannot start, it opens the current version again.
 */
export function winHelperScript(installer: string, appExe: string, pid: number): string {
  return [
    `Wait-Process -Id ${Math.trunc(pid)} -Timeout 60 -ErrorAction SilentlyContinue`,
    // try and catch stay one statement: a ";" between them is a parse error, and PowerShell then
    // runs none of the script.
    `try { Start-Process -FilePath ${psQuote(installer)} -ArgumentList '/S','--updated','--force-run' -ErrorAction Stop } ` +
      `catch { Start-Process -FilePath ${psQuote(appExe)} }`
  ].join('; ')
}
