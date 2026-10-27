// Noctur: the app's side of self-update (checking, progress, cancelling, quitting to install). The
// release logic lives in noctur/update.ts; Koala Clash's version of this file is replaced.
import { app } from 'electron'
import { execFile, spawn } from 'child_process'
import path from 'path'
import { copyFileSync, existsSync, rmSync } from 'fs'
import { getRuntimeConfig } from '../core/factory'
import { dataDir, resourcesFilesDir } from '../utils/dirs'
import { setNotQuitDialog, mainWindow } from '..'
import {
  appleScriptFor,
  ChecksumError,
  downloadVerified,
  fetchLatest,
  MAC_CHECKSUM_EXIT,
  macInstallScript,
  ProxyConfig,
  UpdateInfo
} from '../noctur/update'

/** What the window shows for an update in progress. */
export type UpdatePhase =
  | { phase: 'idle' }
  | { phase: 'downloading'; progress: number }
  // Waiting for the system prompt (password on macOS), installing (macOS, after the password), and
  // quitting to restart into the new version.
  | { phase: 'confirm' }
  | { phase: 'installing' }
  | { phase: 'restarting' }
  | { phase: 'error'; error: 'download' | 'checksum' | 'cancelled' | 'install' }

let latest: UpdateInfo | undefined
let abort: AbortController | null = null

function send(status: UpdatePhase): void {
  mainWindow?.webContents.send('update-status', status)
  if (status.phase === 'downloading') mainWindow?.setProgressBar(status.progress / 100)
  else mainWindow?.setProgressBar(-1)
}

async function proxy(): Promise<ProxyConfig> {
  try {
    const { 'mixed-port': port = 0 } = (await getRuntimeConfig()) ?? {}
    return port ? { protocol: 'http', host: '127.0.0.1', port } : false
  } catch {
    return false
  }
}

export async function checkUpdate(): Promise<AppVersion | undefined> {
  latest = await fetchLatest(app.getVersion(), await proxy())
  if (!latest) return undefined
  return {
    version: latest.version,
    changelog: latest.changelog,
    page: latest.page,
    installable: !!latest.file
  }
}

function quitForUpdate(relaunch: boolean): void {
  send({ phase: 'restarting' })
  setNotQuitDialog()
  if (relaunch) app.relaunch()
  app.quit()
}

function runAppleScript(script: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/osascript', ['-e', script], (err, _out, stderr) => {
      if (!err) return resolve()
      const code = (err as { code?: number }).code
      if (/-128|User canceled/i.test(stderr))
        reject(Object.assign(new Error('cancelled'), { kind: 'cancelled' }))
      // A failed `do shell script` ends its message with the script's exit code: "... (12)".
      else if (
        code === MAC_CHECKSUM_EXIT ||
        new RegExp(`\\(${MAC_CHECKSUM_EXIT}\\)\\s*$`).test(stderr)
      )
        reject(new ChecksumError(stderr))
      else reject(Object.assign(new Error(stderr || String(err)), { kind: 'install' }))
    })
  })
}

/**
 * Windows: starts the update helper (build/runner/update.go) and resolves once it runs. It is a copy
 * of the launcher next to the installer: the installer closes every process started from the
 * install folder and replaces those files. The helper waits for the app to quit, runs the installer
 * and opens the current version again if the update did not install; it logs to update.log.
 */
function startWinHelper(installer: string, version: string): Promise<void> {
  const dir = path.dirname(installer)
  const helper = path.join(dir, 'noctur-update.exe')
  copyFileSync(path.join(resourcesFilesDir(), 'noctur-run.exe'), helper)
  const args = ['update', String(process.pid), installer, app.getPath('exe'), version]
  return new Promise((resolve, reject) => {
    const child = spawn(helper, [...args, path.join(dir, 'update.log')], {
      detached: true,
      stdio: 'ignore'
    })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

export async function downloadAndInstallUpdate(version: string): Promise<void> {
  if (!latest || latest.version !== version) await checkUpdate()
  const file = latest?.version === version ? latest.file : undefined
  if (!file) throw new Error('no installer for this platform')

  const dest = path.join(dataDir(), 'updates', file.name)
  abort = new AbortController()
  try {
    send({ phase: 'downloading', progress: 0 })
    await downloadVerified(
      file,
      dest,
      await proxy(),
      (progress) => send({ phase: 'downloading', progress }),
      abort.signal
    )
  } catch (e) {
    const cancelled = abort.signal.aborted
    send({
      phase: cancelled ? 'idle' : 'error',
      ...(cancelled ? {} : { error: e instanceof ChecksumError ? 'checksum' : 'download' })
    } as UpdatePhase)
    if (cancelled) return
    throw e
  } finally {
    abort = null
  }

  send({ phase: 'confirm' })
  try {
    if (process.platform === 'darwin') {
      // The root script creates the marker first, once the password is accepted.
      const marker = path.join(dataDir(), 'updates', '.installing')
      rmSync(marker, { force: true })
      const watch = setInterval(() => {
        if (existsSync(marker)) {
          clearInterval(watch)
          send({ phase: 'installing' })
        }
      }, 250)
      try {
        await runAppleScript(
          appleScriptFor(macInstallScript({ pkg: dest, sha256: file.sha256, marker }), true)
        )
      } finally {
        clearInterval(watch)
        rmSync(marker, { force: true })
      }
      rmSync(dest, { force: true })
    } else if (process.platform === 'win32') {
      await startWinHelper(dest, version)
    } else {
      throw new Error('no installer for this platform')
    }
  } catch (e) {
    const kind =
      e instanceof ChecksumError
        ? 'checksum'
        : (e as { kind?: string }).kind === 'cancelled'
          ? 'cancelled'
          : 'install'
    send({ phase: 'error', error: kind } as UpdatePhase)
    // Declining the password prompt is not a failure: the line offers Update again.
    if (kind === 'cancelled') return
    throw e
  }
  // macOS: installed, restart into it. Windows: the helper runs the installer once the app is gone,
  // and the installer opens the new version.
  quitForUpdate(process.platform === 'darwin')
}

export async function cancelUpdate(): Promise<void> {
  abort?.abort()
}
