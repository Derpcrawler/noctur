// Noctur: first, so Astra Clash's data folder moves before anything reads the data folder.
import './noctur/migrate-early'
import { createQuitFlow } from './sys/quit-flow'
import { FORK } from './fork'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { registerIpcMainHandlers } from './utils/ipc'
import windowStateKeeper from 'electron-window-state'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  Notification,
  powerMonitor,
  shell
} from 'electron'
import { addProfileItem, getAppConfig, patchControledMihomoConfig } from './config'
import { forceKillCore, quitWithoutCore, startCore, stopCore } from './core/manager'
import { triggerSysProxy } from './sys/sysproxy'
import icon from '../../resources/icon.png?asset'
import { createTray } from './resolve/tray'
import { createApplicationMenu } from './resolve/menu'
import { init } from './utils/init'
import path, { join } from 'path'
import { initShortcut } from './resolve/shortcut'
import { execSync, spawn } from 'child_process'
import { createElevateTaskSync, ELEVATE_TASK } from './sys/misc'
import { initProfileUpdater } from './core/profileUpdater'
import { appendFileSync, existsSync, writeFileSync } from 'fs'
import { exePath, logPath, taskDir } from './utils/dirs'
import { afterPidFromArgv, waitForPidExit } from './noctur/admin-relaunch'
import { hasTrayHost } from './noctur/tray-host'
import { shutdownAndExit } from './noctur/shutdown-sequence'
import { carryAstraAutostart, reportAstraMove } from './noctur/astra-carry'
import { writeFile } from 'fs/promises'
import { showFloatingWindow } from './resolve/floatingWindow'
import { getAppConfigSync } from './config/app'
import { declineElevation, ELEVATION_DECLINED_ARG } from './utils/elevation'
import { t } from './utils/i18n'
import { isHttpUrl } from './utils/url'
import { showCoreError } from './noctur/core-errors'
import { deliverError, windowLoading } from './noctur/pending-errors'


let quitTimeout: NodeJS.Timeout | null = null
export let mainWindow: BrowserWindow | null = null
export let needsFirstRunAdmin = false

export function setNeedsFirstRunAdmin(value: boolean): void {
  needsFirstRunAdmin = value
}

/**
 * Show error to the user via renderer toast notification.
 * Falls back to system dialog if the window is not available.
 */
// Noctur: supportUrl adds the subscription's support link to the error (noctur/core-errors.ts).
// Errors raised before the window listens are kept until it asks (noctur/pending-errors.ts).
export function showError(title: string, message: string, supportUrl?: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const window = mainWindow
    deliverError({ title, message, supportUrl }, (e) =>
      window.webContents.send('showError', e.title, e.message, e.supportUrl)
    )
  } else {
    dialog.showErrorBox(title, message)
  }
}
let pendingDeepLink: string | null = null
let isCreatingWindow = false
let windowShown = false
let createWindowPromiseResolve: (() => void) | null = null
let createWindowPromise: Promise<void> | null = null

async function scheduleLightweightMode(): Promise<void> {
  const {
    autoLightweight = false,
    autoLightweightDelay = 60,
    autoLightweightMode = 'core'
  } = await getAppConfig()

  if (!autoLightweight) return

  if (quitTimeout) {
    clearTimeout(quitTimeout)
  }

  const enterLightweightMode = async (): Promise<void> => {
    if (autoLightweightMode === 'core' && FORK.keepCore) {
      await quitWithoutCore()
    } else {
      if (mainWindow && !mainWindow.isVisible()) {
        mainWindow.destroy()
        if (process.platform === 'darwin' && app.dock) {
          app.dock.hide()
        }
      }
    }
  }

  quitTimeout = setTimeout(enterLightweightMode, autoLightweightDelay * 1000)
}

const syncConfig = getAppConfigSync()

// Set when the previous instance relaunched us after the user dismissed the UAC prompt:
// the refusal is not in the config yet, so honour it from the command line for this run.
const elevationDeclinedByArg = process.argv.includes(ELEVATION_DECLINED_ARG)

if (
  process.platform === 'win32' &&
  !is.dev &&
  !process.argv.includes('noadmin') &&
  !elevationDeclinedByArg &&
  !syncConfig.elevationDeclined &&
  syncConfig.corePermissionMode !== 'service'
) {
  try {
    createElevateTaskSync()
  } catch (createError) {
    try {
      if (process.argv.slice(1).length > 0) {
        writeFileSync(path.join(taskDir(), 'param.txt'), process.argv.slice(1).join(' '))
      } else {
        writeFileSync(path.join(taskDir(), 'param.txt'), 'empty')
      }
      if (!existsSync(path.join(taskDir(), `${ELEVATE_TASK}.exe`))) {
        throw new Error(`${ELEVATE_TASK}.exe not found`)
      } else {
        execSync(`%SystemRoot%\\System32\\schtasks.exe /run /tn ${ELEVATE_TASK}`)
      }
      app.exit()
    } catch {
      // First launch without admin — continue startup and show UI notification
      needsFirstRunAdmin = true
    }
  }
}

if (process.platform === 'win32' && is.dev) {
  patchControledMihomoConfig({ tun: { enable: false } })
}

// Noctur: a copy started by "Restart as administrator" waits for the copy that started it to
// exit, so it gets the single-instance lock (noctur/admin-relaunch.ts).
const afterPid = afterPidFromArgv(process.argv)
if (afterPid !== null && !waitForPidExit(afterPid, 15000)) {
  try {
    writeFileSync(logPath(), `[Elevation]: previous copy (pid ${afterPid}) still running after 15 s\n`, {
      flag: 'a'
    })
  } catch {
    // the log folder may not exist yet
  }
}

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
}

export function customRelaunch(): void {
  const script = `while kill -0 ${process.pid} 2>/dev/null; do
  sleep 0.1
done
${process.argv.join(' ')} & disown
exit
`
  spawn('sh', ['-c', `"${script}"`], {
    shell: true,
    detached: true,
    stdio: 'ignore'
  })
}

if (process.platform === 'linux') {
  app.relaunch = customRelaunch
}

if (process.platform === 'win32' && !exePath().startsWith('C')) {
  // https://github.com/electron/electron/issues/43278
  // https://github.com/electron/electron/issues/36698
  app.commandLine.appendSwitch('in-process-gpu')
}

const initPromise = init()

if (syncConfig.disableGPU) {
  app.disableHardwareAcceleration()
}

function getDeepLinkFromArgs(argv: string[]): string | undefined {
  return argv.find(
    (arg) =>
      arg.startsWith('clash://') || arg.startsWith('mihomo://') || arg.startsWith('noctur://')
  )
}

app.on('second-instance', async (_event, commandline) => {
  showMainWindow()
  const url = getDeepLinkFromArgs(commandline)
  if (url) {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
      await handleDeepLink(url)
    } else {
      pendingDeepLink = url
    }
  }
})

app.on('open-url', async (_event, url) => {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
    await showMainWindow()
    await handleDeepLink(url)
  } else {
    pendingDeepLink = url
  }
})

// Noctur: the before-quit decision lives in sys/quit-flow.ts; an accepted quit sets the shared
// shutdown state (sys/shutdown.ts) that wake recovery checks.
const shutdownSteps = {
  disableSystemProxy: () => triggerSysProxy(false, false),
  stopCore: () => stopCore(),
  killCore: () => forceKillCore(),
  exit: () => app.exit(),
  log: (line: string) => {
    try {
      appendFileSync(logPath(), line)
    } catch {
      // logging must not stop the exit
    }
  }
}

const quitFlow = createQuitFlow({
  confirm: () => showQuitConfirmDialog(),
  shutdown: async () => {
    if (quitTimeout) {
      clearTimeout(quitTimeout)
      quitTimeout = null
    }
    // Noctur: wait for the system proxy to be off and the core stopped, then exit, also when
    // either fails or hangs (noctur/shutdown-sequence.ts).
    await shutdownAndExit(shutdownSteps)
  }
})

export function setNotQuitDialog(): void {
  quitFlow.setNotQuitDialog()
}

function showWindow(): number {
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    } else if (!mainWindow.isVisible()) {
      mainWindow.show()
    }
    mainWindow.focusOnWebView()
    mainWindow.setAlwaysOnTop(true, 'pop-up-menu')
    mainWindow.focus()
    mainWindow.setAlwaysOnTop(false)

    if (!mainWindow.isMinimized()) {
      return 100
    }
  }
  return 500
}

function showQuitConfirmDialog(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!mainWindow) {
      resolve(true)
      return
    }

    const delay = showWindow()
    setTimeout(() => {
      mainWindow?.webContents.send('show-quit-confirm')
      const handleQuitConfirm = (_event: Electron.IpcMainEvent, confirmed: boolean): void => {
        ipcMain.off('quit-confirm-result', handleQuitConfirm)
        resolve(confirmed)
      }
      ipcMain.once('quit-confirm-result', handleQuitConfirm)
    }, delay)
  })
}

app.on('window-all-closed', () => {
  // Don't quit app when all windows are closed
})

app.on('before-quit', (e) => {
  void quitFlow.onBeforeQuit(e)
})

powerMonitor.on('shutdown', async () => {
  // Noctur: the same single shutdown as Quit (sys/quit-flow.ts), so a quit already under way
  // is joined rather than run twice.
  await quitFlow.shutdownNow()
})

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('app.noctur.desktop')
  try {
    await initPromise
  } catch (e) {
    dialog.showErrorBox(t('dialog.appInitFailed'), `${e}`)
    app.quit()
  }

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })
  const appConfig = await getAppConfig()
  if (elevationDeclinedByArg && !appConfig.elevationDeclined) {
    await declineElevation()
  }
  const { showFloatingWindow: showFloating = false, disableTray = false } = appConfig
  registerIpcMainHandlers()
  void carryAstraAutostart()
  reportAstraMove()

  // Check process.argv for deep link URL (cold start on Windows/Linux)
  if (!pendingDeepLink) {
    const deepLinkArg = getDeepLinkFromArgs(process.argv)
    if (deepLinkArg) {
      pendingDeepLink = deepLinkArg
    }
  }

  if (process.platform === 'win32') {
    try {
      writeFileSync(path.join(taskDir(), 'param.txt'), 'empty')
    } catch {
      // ignore
    }
  }

  const createWindowPromise = createWindow(appConfig)

  let coreStarted = false

  const coreStartPromise = (async (): Promise<void> => {
    try {
      const [startPromise] = await startCore()
      // Noctur: startup can end without the providers (core exit, TUN permission error, a
      // stop); that is logged instead of left as an unhandled rejection.
      startPromise.then(
        async () => {
          await initProfileUpdater()
        },
        (e) => {
          writeFile(logPath(), `[Manager]: core not ready: ${e}\n`, { flag: 'a' }).catch(() => {})
        }
      )
      coreStarted = true
    } catch (e) {
      await showCoreError(t('dialog.coreStartError'), e)
    }
  })()

  await createWindowPromise

  const uiTasks: Promise<void>[] = [initShortcut()]

  if (showFloating) {
    uiTasks.push(Promise.resolve(showFloatingWindow()))
  }
  if (!disableTray) {
    uiTasks.push(createTray())
  }

  await Promise.all(uiTasks)

  await Promise.all([coreStartPromise])

  if (coreStarted) {
    mainWindow?.webContents.send('core-started')
  }

  if (needsFirstRunAdmin) {
    mainWindow?.webContents.send('needs-admin-setup')
  }

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    showMainWindow()
  })
})

async function handleDeepLink(url: string): Promise<void> {
  if (
    !url.startsWith('clash://') &&
    !url.startsWith('mihomo://') &&
    !url.startsWith('noctur://')
  )
    return

  const urlObj = new URL(url)
  switch (urlObj.host) {
    case 'install-config': {
      try {
        const profileUrl = urlObj.searchParams.get('url')
        const profileName = urlObj.searchParams.get('name')
        if (!profileUrl) {
          throw new Error(t('error.missingUrlParam'))
        }

        const confirmed = await showProfileInstallConfirm(profileUrl, profileName)

        if (confirmed) {
          await addProfileItem({
            type: 'remote',
            name: profileName ?? undefined,
            url: profileUrl
          })
          mainWindow?.webContents.send('profileConfigUpdated')
          new Notification({ title: t('notification.profileImportSuccess') }).show()
        }
      } catch (e) {
        const hwidLimitMatch = `${e}`.match(/HWID_LIMIT:(.*)/)
        if (hwidLimitMatch && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('show-hwid-limit-error', hwidLimitMatch[1].trim())
          return
        }
        showError(t('dialog.profileImportFailed'), `${url}\n${e}`)
      }
      break
    }
  }
}

async function showProfileInstallConfirm(url: string, name?: string | null): Promise<boolean> {
  if (!mainWindow) {
    await createWindow()
  }
  let extractedName = name

  if (!extractedName) {
    try {
      const axios = (await import('axios')).default
      const response = await axios.head(url, {
        timeout: 5000
      })

      if (response.headers['profile-title']) {
        const titleValue = response.headers['profile-title']
        if (titleValue.startsWith('base64:')) {
          extractedName = Buffer.from(titleValue.slice(7), 'base64').toString('utf-8')
        } else {
          extractedName = titleValue
        }
      } else {
        if (response.headers['content-disposition']) {
          extractedName = parseFilename(response.headers['content-disposition'])
        }
      }
    } catch (error) {
      // ignore
    }
  }

  return new Promise((resolve) => {
    const delay = showWindow()
    setTimeout(() => {
      mainWindow?.webContents.send('show-profile-install-confirm', {
        url,
        name: extractedName || name
      })
      const handleConfirm = (_event: Electron.IpcMainEvent, confirmed: boolean): void => {
        ipcMain.off('profile-install-confirm-result', handleConfirm)
        resolve(confirmed)
      }
      ipcMain.once('profile-install-confirm-result', handleConfirm)
    }, delay)
  })
}

function parseFilename(str: string): string {
  if (str.match(/filename\*=.*''/)) {
    return decodeURIComponent(str.split(/filename\*=.*''/)[1])
  } else {
    const filename = str.split('filename=')[1]
    return filename?.replace(/"/g, '') || ''
  }
}

// Noctur: Windows caption buttons over a background color: light symbols on dark palettes,
// dark symbols on light ones.
function winCaptionColors(bg: string): { color: string; symbolColor: string; height: number } {
  const n = parseInt(bg.slice(1), 16)
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)
  return { color: '#00000000', symbolColor: lum < 128 ? '#e8ebf2' : '#1d222b', height: 32 }
}

export async function createWindow(appConfig?: AppConfig): Promise<void> {
  if (isCreatingWindow) {
    if (createWindowPromise) {
      await createWindowPromise
    }
    return
  }
  isCreatingWindow = true
  createWindowPromise = new Promise<void>((resolve) => {
    createWindowPromiseResolve = resolve
  })
  try {
    const config = appConfig ?? (await getAppConfig())
    const { useWindowFrame = process.platform === 'linux' } = config

    const [mainWindowState] = await Promise.all([
      Promise.resolve(
        windowStateKeeper({
          defaultWidth: 800,
          defaultHeight: 700,
          file: 'window-state.json'
        })
      ),
      process.platform === 'darwin'
        ? createApplicationMenu()
        : Promise.resolve(Menu.setApplicationMenu(null))
    ])
    mainWindow = new BrowserWindow({
      minWidth: 800,
      minHeight: 600,
      width: mainWindowState.width,
      height: mainWindowState.height,
      x: mainWindowState.x,
      y: mainWindowState.y,
      show: false,
      frame: useWindowFrame,
      fullscreenable: false,
      titleBarStyle: useWindowFrame ? 'default' : 'hidden',
      titleBarOverlay: false,
      // Noctur: the color macOS shows in newly exposed areas during a resize, before the page
      // repaints. The page then sends the exact palette background (nocturWindowBackground below).
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#050812' : '#f5f7fb',
      // Noctur: same inset as Finder (16.5 pt from the top and left edges).
      ...(process.platform === 'darwin' && !useWindowFrame && FORK.nativeWindowButtons
        ? { trafficLightPosition: { x: 17, y: 17 } }
        : {}),
      // Noctur: native Windows caption buttons (with Snap Layouts) drawn over the page instead of
      // the page's own buttons. Transparent so the page background shows behind them; the symbol
      // color follows the palette (nocturWindowBackground below). Page headers leave room for them
      // through the titlebar-area CSS env() values (fork-theme.css).
      ...(process.platform === 'win32' && !useWindowFrame && FORK.nativeWindowButtons
        ? { titleBarOverlay: winCaptionColors(nativeTheme.shouldUseDarkColors ? '#050812' : '#f5f7fb') }
        : {}),
      autoHideMenuBar: true,
      ...(process.platform === 'linux' ? { icon: icon } : {}),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        spellcheck: false,
        sandbox: false
      }
    })
    mainWindowState.manage(mainWindow)
    // Noctur: keep the window's base color equal to the palette background (see backgroundColor).
    ipcMain.removeAllListeners('nocturWindowBackground')
    ipcMain.on('nocturWindowBackground', (_e, color: unknown) => {
      if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) return
      mainWindow?.setBackgroundColor(color)
      if (process.platform === 'win32' && !useWindowFrame && FORK.nativeWindowButtons) {
        mainWindow?.setTitleBarOverlay(winCaptionColors(color))
      }
    })
    if (process.platform === 'darwin' && !useWindowFrame && !FORK.nativeWindowButtons) {
      mainWindow.setWindowButtonVisibility(false)
    }
    mainWindow.on('maximize', () => {
      mainWindow?.webContents.send('window-maximized')
    })
    mainWindow.on('ready-to-show', async () => {
      const { silentStart = false } = await getAppConfig()
      if (!silentStart) {
        if (quitTimeout) {
          clearTimeout(quitTimeout)
        }
        windowShown = true
        mainWindow?.show()
        mainWindow?.focusOnWebView()
      } else {
        await scheduleLightweightMode()
      }
    })
    mainWindow.webContents.on('did-fail-load', () => {
      mainWindow?.webContents.reload()
    })

    mainWindow.webContents.on('render-process-gone', (_event, details) => {
      if (details.reason === 'clean-exit') return
      if (!mainWindow || mainWindow.isDestroyed()) return
      try {
        mainWindow.webContents.reload()
      } catch {
        // ignore
      }
    })

    mainWindow.webContents.on('unresponsive', () => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      try {
        mainWindow.webContents.forcefullyCrashRenderer()
        mainWindow.webContents.reload()
      } catch {
        // ignore
      }
    })

    mainWindow.on('focus', () => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      try {
        mainWindow.webContents.invalidate()
      } catch {
        // ignore
      }
    })

    mainWindow.on('show', () => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      try {
        mainWindow.webContents.invalidate()
      } catch {
        // ignore
      }
    })

    // A new page has to ask for kept errors before they are sent to it.
    windowLoading()
    mainWindow.webContents.on('did-start-loading', windowLoading)
    mainWindow.webContents.once('did-finish-load', () => {
      if (pendingDeepLink) {
        const url = pendingDeepLink
        pendingDeepLink = null
        setTimeout(() => {
          handleDeepLink(url)
        }, 500)
      }
    })

    mainWindow.on('close', async (event) => {
      event.preventDefault()
      // Noctur: without a tray on Linux, closing the window quits (after the usual
      // confirmation) instead of hiding the app with no way back to Quit (noctur/tray-host.ts).
      if (process.platform === 'linux' && !(await hasTrayHost())) {
        app.quit()
        return
      }
      mainWindow?.hide()
      if (windowShown) {
        await scheduleLightweightMode()
      }
    })

    mainWindow.on('closed', () => {
      mainWindow = null
    })

    mainWindow.on('resized', () => {
      if (mainWindow) mainWindowState.saveState(mainWindow)
    })

    mainWindow.on('unmaximize', () => {
      if (mainWindow) mainWindowState.saveState(mainWindow)
      mainWindow?.webContents.send('window-unmaximized')
    })

    mainWindow.on('move', () => {
      if (mainWindow) mainWindowState.saveState(mainWindow)
    })

    mainWindow.on('session-end', async () => {
      triggerSysProxy(false, false)
      await stopCore()
    })

    mainWindow.webContents.setWindowOpenHandler((details) => {
      if (isHttpUrl(details.url)) {
        void shell.openExternal(details.url)
      }
      return { action: 'deny' }
    })
    // HMR for renderer base on electron-vite cli.
    // Load the remote URL for development or the local html file for production.
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }
  } finally {
    isCreatingWindow = false
    if (createWindowPromiseResolve) {
      createWindowPromiseResolve()
      createWindowPromiseResolve = null
    }
    createWindowPromise = null
  }
}

export async function triggerMainWindow(): Promise<void> {
  if (mainWindow && mainWindow.isVisible()) {
    closeMainWindow()
  } else {
    await showMainWindow()
  }
}

export async function showMainWindow(): Promise<void> {
  if (quitTimeout) {
    clearTimeout(quitTimeout)
  }
  if (process.platform === 'darwin' && app.dock) {
    const { useDockIcon = true } = await getAppConfig()
    if (!useDockIcon) {
      app.dock.hide()
    }
  }
  if (mainWindow) {
    windowShown = true
    mainWindow.show()
    mainWindow.focusOnWebView()
  } else {
    await createWindow()
    if (mainWindow !== null) {
      windowShown = true
      ;(mainWindow as BrowserWindow).show()
      ;(mainWindow as BrowserWindow).focusOnWebView()
    }
  }
}

export function closeMainWindow(): void {
  if (mainWindow) {
    mainWindow.close()
  }
}
