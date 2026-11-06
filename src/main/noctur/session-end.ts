// Noctur: Windows reports a shutdown, restart or logout only to windows: Electron's `session-end`
// is a window event there, and quit events and powerMonitor's `shutdown` do not fire. The main window
// can be gone (lightweight mode), so a hidden window that loads no page stays for the whole run.
import { BrowserWindow } from 'electron'

let holder: BrowserWindow | null = null

export function watchSessionEnd(cleanup: () => Promise<void>): void {
  if (process.platform !== 'win32' || holder) return
  holder = new BrowserWindow({
    show: false,
    frame: false,
    skipTaskbar: true,
    focusable: false,
    width: 1,
    height: 1,
    paintWhenInitiallyHidden: false
  })
  holder.on('session-end', () => {
    void cleanup()
  })
}
