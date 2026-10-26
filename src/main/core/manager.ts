import { DEFAULT_STOP_TIMINGS, isChildRunning, killChildNow, stopChildProcess } from './child-process'
import { StartupWatch, watchStartup } from './startup-watch'
import { ProviderTracker, ProviderWait, ProviderWaitCancelled } from './provider-tracker'
import { isShuttingDown } from '../sys/shutdown'
import { hasCoreCapsSync, isPkexecCancel, readCapsState, setCoreCaps } from '../noctur/core-caps'
import { ChildProcess, execFile, execFileSync, spawn } from 'child_process'
import {
  dataDir,
  logPath,
  mihomoCorePath,
  mihomoIpcPath,
  mihomoProfileWorkDir,
  mihomoTestDir,
  mihomoWorkConfigPath,
  mihomoWorkDir
} from '../utils/dirs'
import { generateProfile, getRuntimeConfig } from './factory'
import {
  getAppConfig,
  getControledMihomoConfig,
  getProfileConfig,
  patchAppConfig,
  patchControledMihomoConfig
} from '../config'
import { app, ipcMain, net } from 'electron'
import {
  startMihomoTraffic,
  startMihomoConnections,
  startMihomoLogs,
  startMihomoMemory,
  stopMihomoConnections,
  stopMihomoTraffic,
  stopMihomoLogs,
  stopMihomoMemory,
  applyLogLevel,
  mihomoGroups
} from './mihomoApi'
import { readFile, rm, writeFile } from 'fs/promises'
import { promisify } from 'util'
import { mainWindow } from '..'
import path from 'path'
import os from 'os'
import { createWriteStream, existsSync } from 'fs'
import { disableSysProxy, triggerSysProxy } from '../sys/sysproxy'
import { getAxios } from './mihomoApi'
import { setSysDns } from '../service/api'
import { DEFAULT_DNS_MODE, DnsDeps, defaultRun, pointDnsIntoTunnel, restoreDns } from '../noctur/system-dns'
import { t } from '../utils/i18n'
import { CoreMissingError, ProfileRejectedError, showCoreError } from '../noctur/core-errors'

const ctlParam = process.platform === 'win32' ? '-ext-ctl-pipe' : '-ext-ctl-unix'

class UserCancelledError extends Error {
  constructor(message = t('tray.userCancelled')) {
    super(message)
    this.name = 'UserCancelledError'
  }
}

function isUserCancelledError(error: unknown): boolean {
  if (error instanceof UserCancelledError) {
    return true
  }
  const errorMsg = error instanceof Error ? error.message : String(error)
  return (
    errorMsg.includes(t('tray.userCancelledCheck')) ||
    errorMsg.includes('User canceled') ||
    errorMsg.includes('(-128)') ||
    errorMsg.includes('user cancelled') ||
    errorMsg.includes('dismissed')
  )
}

let setPublicDNSTimer: NodeJS.Timeout | null = null
let recoverDNSTimer: NodeJS.Timeout | null = null
let networkDetectionTimer: NodeJS.Timeout | null = null
let networkDownHandled = false

let child: ChildProcess
let retry = 10


const normalize = (s: string): string =>
  s
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .normalize('NFC')

// Noctur: limits for core startup. Exported so tests can shorten them.
export const STARTUP_LIMITS = {
  /** Wait for the controller line before asking the API instead. */
  controllerMs: 30_000,
  /** Wait for the provider lines before asking the API instead. */
  providersMs: 30_000,
  /** API attempts, 100 ms apart, before startup counts as failed. */
  apiTries: 30
}

// Noctur: provider start tracking for core starts and hot reloads (core/provider-tracker.ts).
async function waitForApi(): Promise<void> {
  for (let i = 0; i < STARTUP_LIMITS.apiTries; i++) {
    try {
      await mihomoGroups()
      return
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  throw new Error(t('tray.coreStartError'))
}

const providerTracker = new ProviderTracker({
  normalize,
  waitForApi,
  get timeoutMs() {
    return STARTUP_LIMITS.providersMs
  },
  onTunPermissionError: () => {
    patchControledMihomoConfig({ tun: { enable: false } })
    mainWindow?.webContents.send('controledMihomoConfigUpdated')
    ipcMain.emit('updateTrayMenu')
    return t('tray.tunStartFailed')
  }
})

let currentWatch: StartupWatch | null = null

function notifyProvidersReady(): void {
  mainWindow?.webContents.send('groupsUpdated')
  mainWindow?.webContents.send('rulesUpdated')
}

/** After a successful hot reload: refresh groups and rules once its providers have started. */
export function announceReload(wait: ProviderWait): void {
  wait.ready.then(notifyProvidersReady, () => {})
}

// Starts a wait for the current runtime config's providers (core start or hot reload) and returns
// its handle; the handle's cancel() ends only this wait.
export async function resetProviderTracking(): Promise<ProviderWait> {
  const { 'rule-providers': ruleProviders, 'proxy-providers': proxyProviders } =
    await getRuntimeConfig()
  const names = new Set(
    [...Object.keys(ruleProviders || {}), ...Object.keys(proxyProviders || {})].map(normalize)
  )
  return providerTracker.arm(names)
}

export async function startCore(detached = false): Promise<Promise<void>[]> {
  const {
    core = 'mihomo',
    autoSetDNSMode = DEFAULT_DNS_MODE,
    diffWorkDir = false,
    mihomoCpuPriority = 'PRIORITY_NORMAL',
    disableLoopbackDetector = false,
    disableEmbedCA = false,
    disableSystemCA = false,
    disableNftables = false,
    safePaths = []
  } = await getAppConfig()
  const { current } = await getProfileConfig()
  const { tun } = await getControledMihomoConfig()

  let corePath: string
  try {
    corePath = mihomoCorePath(core)
  } catch (error) {
    // Noctur: also a config that names the alpha core, which is not shipped.
    if (core !== 'mihomo') {
      await patchAppConfig({ core: 'mihomo' })
      return startCore(detached)
    }
    throw error
  }
  // Noctur: before the config check, which would otherwise fail with only a spawn error.
  if (!existsSync(corePath)) throw new CoreMissingError(corePath)

  const { logLevel } = await generateProfile()
  await checkProfile()
  await stopCore()
  if (tun?.enable && autoSetDNSMode !== 'none') {
    try {
      await setPublicDNS()
    } catch (error) {
      await writeFile(logPath(), `[Manager]: set dns failed, ${error}`, {
        flag: 'a'
      })
    }
  }
  const { ready } = await resetProviderTracking()
  const stdout = createWriteStream(logPath(), { flags: 'a' })
  const stderr = createWriteStream(logPath(), { flags: 'a' })
  const env = {
    DISABLE_LOOPBACK_DETECTOR: String(disableLoopbackDetector),
    DISABLE_EMBED_CA: String(disableEmbedCA),
    DISABLE_SYSTEM_CA: String(disableSystemCA),
    DISABLE_NFTABLES: String(disableNftables),
    SAFE_PATHS: safePaths.join(path.delimiter),
    PATH: process.env.PATH
  }
  // Noctur: no new core once a quit is accepted (sys/shutdown.ts). Checked right before the
  // spawn with no await in between, so a restart that was already under way cannot start a core
  // behind a shutdown that began during its earlier steps.
  if (isShuttingDown()) throw new ShutdownInProgress()
  child = spawn(
    corePath,
    [
      '-d',
      diffWorkDir ? mihomoProfileWorkDir(current) : mihomoWorkDir(),
      ctlParam,
      mihomoIpcPath()
    ],
    {
      detached: detached,
      stdio: detached ? 'ignore' : undefined,
      env: env
    }
  )
  if (process.platform === 'win32' && child.pid) {
    os.setPriority(child.pid, os.constants.priority[mihomoCpuPriority])
  }
  if (detached) {
    child.unref()
    return new Promise((resolve) => {
      resolve([new Promise(() => {})])
    })
  }
  child.on('close', async (code, signal) => {
    await writeFile(logPath(), `[Manager]: Core closed, code: ${code}, signal: ${signal}\n`, {
      flag: 'a'
    })
    if (retry) {
      await writeFile(logPath(), `[Manager]: Try Restart Core\n`, { flag: 'a' })
      retry--
      await restartCore()
    } else {
      await stopCore()
    }
  })
  child.stdout?.pipe(stdout)
  child.stderr?.pipe(stderr)
  // Noctur: startup log read line by line from the first byte (core/startup-watch.ts); later
  // lines feed provider tracking.
  const watch = watchStartup(child, {
    platform: process.platform,
    startupTimeoutMs: STARTUP_LIMITS.controllerMs,
    waitForApi,
    onLine: (line) => providerTracker.feed(line),
    onEnd: (reason) => providerTracker.failAll(reason),
    onUpdaterFinished: async () => {
      try {
        await stopCore(true)
        const promises = await startCore()
        await Promise.all(promises)
      } catch (e) {
        await showCoreError(t('tray.coreStartError'), e)
      }
    }
  })
  currentWatch = watch
  try {
    await watch.controller
  } catch (e) {
    providerTracker.failAll(e)
    throw e instanceof Error ? e : `${t('tray.controllerListenError')}:\n${e}`
  }
  void (async (): Promise<void> => {
    await startMihomoTraffic()
    await startMihomoConnections()
    startMihomoLogs(logLevel)
    await startMihomoMemory()
    retry = 10
  })()
  return [
    ready.then(async () => {
      await new Promise((r) => setTimeout(r, 100))
      notifyProvidersReady()
      await applyLogLevel(logLevel)
    })
  ]
}

export async function stopCore(force = false): Promise<void> {
  stopMihomoTraffic()
  stopMihomoConnections()
  stopMihomoLogs()
  stopMihomoMemory()

  // Noctur: whether the core still runs comes from its exit status (core/child-process.ts),
  // not ChildProcess.killed, which turns true as soon as SIGINT is sent. The core gets SIGINT
  // before the DNS restore, which has no time limit of its own: a quit that runs out of time then
  // meets a core that already had its chance to stop (noctur/shutdown-sequence.ts).
  currentWatch?.stop()
  currentWatch = null
  providerTracker.cancelAll()
  // The core this stop is about. While the DNS restore runs, a restart elsewhere can start a new
  // core; only this one may be forgotten at the end.
  const target = child
  const stopping = isChildRunning(target)
    ? stopChildProcess(target, DEFAULT_STOP_TIMINGS, (line) => {
        writeFile(logPath(), line, { flag: 'a' }).catch(() => {})
      })
    : Promise.resolve()
  try {
    if (!force) {
      await recoverDNS()
    }
  } catch (error) {
    await writeFile(logPath(), `[Manager]: recover dns failed, ${error}`, {
      flag: 'a'
    }).catch(() => {})
  }
  await stopping
  if (child === target) child = undefined as unknown as ChildProcess

  await getAxios(true).catch(() => {})

  if (existsSync(path.join(dataDir(), 'core.pid'))) {
    const pidString = await readFile(path.join(dataDir(), 'core.pid'), 'utf-8')
    const pid = parseInt(pidString.trim())
    if (!isNaN(pid)) {
      try {
        process.kill(pid, 0)
        process.kill(pid, 'SIGINT')
        await new Promise((resolve) => setTimeout(resolve, 1000))
        try {
          process.kill(pid, 0)
          process.kill(pid, 'SIGKILL')
        } catch {
          // ignore
        }
      } catch {
        // ignore
      }
    }
    await rm(path.join(dataDir(), 'core.pid')).catch(() => {})
  }
}

// Noctur: the quit's last step before every exit (noctur/shutdown-sequence.ts): SIGKILL for the
// tracked core if it is still running, a no-op after a clean stop.
export function forceKillCore(): Promise<void> {
  return child && isChildRunning(child) ? killChildNow(child) : Promise.resolve()
}

export function hasCoreProcess(): boolean {
  return isChildRunning(child)
}

export class ShutdownInProgress extends Error {
  constructor() {
    super('The app is shutting down')
  }
}

// Noctur: restarts run one at a time: each stops the core and starts the next before the
// following restart begins, so two quick restarts cannot both start a core. The wait for the new
// core's providers happens outside the queue; when a later restart stops that core first, the
// cancelled wait ends quietly instead of showing an error.
let restartQueue: Promise<unknown> = Promise.resolve()

export function restartCore(): Promise<void> {
  const step = restartQueue.then(async () => {
    await stopCore()
    if (isShuttingDown()) return null
    return startCore()
  })
  restartQueue = step.catch(() => {})
  return step
    .then(async (promises) => {
      if (promises) await Promise.all(promises)
    })
    .catch((e) => {
      // A restart that meets an accepted quit, or is overtaken by a later one, simply ends.
      if (e instanceof ShutdownInProgress || e instanceof ProviderWaitCancelled) return
      return showCoreError(t('tray.coreStartError'), e)
    })
}

export async function keepCoreAlive(): Promise<void> {
  try {
    await startCore(true)
    if (child && child.pid) {
      await writeFile(path.join(dataDir(), 'core.pid'), child.pid.toString())
    }
  } catch (e) {
    await showCoreError(t('tray.coreStartError'), e)
  }
}

export async function quitWithoutCore(): Promise<void> {
  await keepCoreAlive()
  app.exit()
}

async function checkProfile(): Promise<void> {
  const { core = 'mihomo', diffWorkDir = false, safePaths = [] } = await getAppConfig()
  const { current } = await getProfileConfig()
  const corePath = mihomoCorePath(core)
  const execFilePromise = promisify(execFile)
  const env = {
    SAFE_PATHS: safePaths.join(path.delimiter)
  }
  try {
    await execFilePromise(
      corePath,
      [
        '-t',
        '-f',
        diffWorkDir ? mihomoWorkConfigPath(current) : mihomoWorkConfigPath('work'),
        '-d',
        mihomoTestDir()
      ],
      { env }
    )
  } catch (error) {
    if (error instanceof Error && 'stdout' in error) {
      const { stdout } = error as { stdout: string }
      const errorLines = stdout
        .split('\n')
        .filter((line) => line.includes('level=error'))
        .map((line) => line.split('level=error')[1])
      throw new ProfileRejectedError(errorLines.join('\n'))
    } else {
      throw error
    }
  }
}

export async function manualGrantCorePermition(
  cores?: ('mihomo')[]
): Promise<void> {
  const execFilePromise = promisify(execFile)

  // Noctur: Linux grants file capabilities, not setuid root (noctur/core-caps.ts).
  if (process.platform === 'linux') {
    const targets = (cores || ['mihomo']).map((c) => mihomoCorePath(c))
    try {
      await setCoreCaps(targets, true)
    } catch (error) {
      if (isPkexecCancel(error) || isUserCancelledError(error)) throw new UserCancelledError()
      throw error
    }
    return
  }

  const grantPermission = async (coreName: 'mihomo'): Promise<void> => {
    const corePath = mihomoCorePath(coreName)
    try {
      if (process.platform === 'darwin') {
        const escapedPath = corePath.replace(/"/g, '\\"')
        const shell = `chown root:admin \\"${escapedPath}\\" && chmod +sx \\"${escapedPath}\\"`
        const command = `do shell script "${shell}" with administrator privileges`
        await execFilePromise('osascript', ['-e', command])
      }
    } catch (error) {
      if (isUserCancelledError(error)) {
        throw new UserCancelledError()
      }
      throw error
    }
  }

  const targetCores = cores || ['mihomo']
  await Promise.all(targetCores.map((core) => grantPermission(core)))
}

export function checkCorePermissionSync(coreName: 'mihomo'): boolean {
  if (process.platform === 'win32') return true
  if (process.platform === 'linux') return hasCoreCapsSync(mihomoCorePath(coreName))
  try {
    const corePath = mihomoCorePath(coreName)
    const stdout = execFileSync('ls', ['-l', corePath], { encoding: 'utf8' })
    const permissions = stdout.trim().split(/\s+/)[0]
    return permissions.includes('s') || permissions.includes('S')
  } catch {
    return false
  }
}

// Noctur: on Linux 'partial' means some capability is set but TUN would not work; the dialog
// shows it so the rest can be removed or completed.
type CorePermission = boolean | 'partial'

export async function checkCorePermission(): Promise<{ mihomo: CorePermission }> {
  const execFilePromise = promisify(execFile)

  const checkPermission = async (coreName: 'mihomo'): Promise<CorePermission> => {
    if (process.platform === 'linux') {
      const state = await readCapsState(mihomoCorePath(coreName)).catch(() => 'none' as const)
      return state === 'full' ? true : state === 'partial' ? 'partial' : false
    }
    try {
      const corePath = mihomoCorePath(coreName)
      const { stdout } = await execFilePromise('ls', ['-l', corePath])
      const permissions = stdout.trim().split(/\s+/)[0]
      return permissions.includes('s') || permissions.includes('S')
    } catch (error) {
      return false
    }
  }

  return { mihomo: await checkPermission('mihomo') }
}

export async function revokeCorePermission(cores?: ('mihomo')[]): Promise<void> {
  const execFilePromise = promisify(execFile)

  // Noctur: Linux removes any file capability a core has, complete or not (noctur/core-caps.ts),
  // then checks that none is left. setcap -r fails on a file without capabilities, so only cores
  // that have some are passed; a core whose capabilities cannot be read stops the revoke.
  if (process.platform === 'linux') {
    const paths = (cores || ['mihomo']).map((c) => mihomoCorePath(c)).filter((p) => existsSync(p))
    const withCaps: string[] = []
    for (const p of paths) if ((await readCapsState(p)) !== 'none') withCaps.push(p)
    try {
      await setCoreCaps(withCaps, false)
    } catch (error) {
      if (isPkexecCancel(error) || isUserCancelledError(error)) throw new UserCancelledError()
      throw error
    }
    for (const p of withCaps) {
      if ((await readCapsState(p)) !== 'none') throw new Error(`Capabilities are still set on ${p}`)
    }
    return
  }

  const revokePermission = async (coreName: 'mihomo'): Promise<void> => {
    const corePath = mihomoCorePath(coreName)
    try {
      if (process.platform === 'darwin') {
        const escapedPath = corePath.replace(/"/g, '\\"')
        const shell = `chmod a-s \\"${escapedPath}\\"`
        const command = `do shell script "${shell}" with administrator privileges`
        await execFilePromise('osascript', ['-e', command])
      }
    } catch (error) {
      if (isUserCancelledError(error)) {
        throw new UserCancelledError()
      }
      throw error
    }
  }

  const targetCores = cores || ['mihomo']
  await Promise.all(targetCores.map((core) => revokePermission(core)))
}

export async function getDefaultDevice(): Promise<string> {
  const execFilePromise = promisify(execFile)
  const { stdout: deviceOut } = await execFilePromise('route', ['-n', 'get', 'default'])
  let device = deviceOut.split('\n').find((s) => s.includes('interface:'))
  device = device?.trim().split(' ').slice(1).join(' ')
  if (!device) throw new Error('Get device failed')
  return device
}

// Noctur: the DNS steps live in noctur/system-dns.ts (every network service, each original saved,
// one default for the mode); these keep upstream's names and the retry while offline.
const systemDnsDeps: DnsDeps = {
  run: defaultRun,
  setViaService: (service, servers) => setSysDns(service, servers),
  getConfig: getAppConfig,
  patchConfig: patchAppConfig
}

export async function setPublicDNS(): Promise<void> {
  if (process.platform !== 'darwin') return
  if (recoverDNSTimer) clearTimeout(recoverDNSTimer)
  if (net.isOnline()) {
    await pointDnsIntoTunnel(systemDnsDeps)
  } else {
    if (setPublicDNSTimer) clearTimeout(setPublicDNSTimer)
    setPublicDNSTimer = setTimeout(() => setPublicDNS(), 5000)
  }
}

export async function recoverDNS(): Promise<void> {
  if (process.platform !== 'darwin') return
  if (setPublicDNSTimer) clearTimeout(setPublicDNSTimer)
  if (net.isOnline()) {
    await restoreDns(systemDnsDeps)
  } else {
    if (recoverDNSTimer) clearTimeout(recoverDNSTimer)
    recoverDNSTimer = setTimeout(() => recoverDNS(), 5000)
  }
}

export async function startNetworkDetection(): Promise<void> {
  const {
    onlyActiveDevice = false,
    networkDetectionBypass = [],
    networkDetectionInterval = 10,
    sysProxy = { enable: false },
    proxyMode = false
  } = await getAppConfig()
  const writeSysProxy = proxyMode && sysProxy.enable
  const { tun: { device = process.platform === 'darwin' ? undefined : 'mihomo' } = {} } =
    await getControledMihomoConfig()
  if (networkDetectionTimer) {
    clearInterval(networkDetectionTimer)
  }
  const extendedBypass = networkDetectionBypass.concat(
    [device, 'lo', 'docker0', 'utun'].filter((item): item is string => item !== undefined)
  )

  networkDetectionTimer = setInterval(async () => {
    if (isAnyNetworkInterfaceUp(extendedBypass) && net.isOnline()) {
      if ((networkDownHandled && !child) || (child && !isChildRunning(child))) {
        // Noctur: a failed or cancelled start here is logged, not left unhandled.
        try {
          const promises = await startCore()
          await Promise.all(promises)
        } catch (e) {
          await writeFile(logPath(), `[Manager]: start after network up failed, ${e}\n`, { flag: 'a' }).catch(() => {})
          return
        }
        if (writeSysProxy) triggerSysProxy(true, onlyActiveDevice)
        networkDownHandled = false
      }
    } else {
      if (!networkDownHandled) {
        if (writeSysProxy) disableSysProxy(onlyActiveDevice)
        await stopCore()
        networkDownHandled = true
      }
    }
  }, networkDetectionInterval * 1000)
}

export async function stopNetworkDetection(): Promise<void> {
  if (networkDetectionTimer) {
    clearInterval(networkDetectionTimer)
    networkDetectionTimer = null
  }
}

function isAnyNetworkInterfaceUp(excludedKeywords: string[] = []): boolean {
  const interfaces = os.networkInterfaces()
  return Object.entries(interfaces).some(([name, ifaces]) => {
    if (excludedKeywords.some((keyword) => name.includes(keyword))) return false

    return ifaces?.some((iface) => {
      return !iface.internal && (iface.family === 'IPv4' || iface.family === 'IPv6')
    })
  })
}
