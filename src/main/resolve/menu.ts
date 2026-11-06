import { app, Menu, shell } from 'electron'
import { openMainWindowPage } from '..'
import { getAppConfig } from '../config'
import { quitWithoutCore } from '../core/manager'
import { FORK } from '../fork'
import { dataDir, logDir } from '../utils/dirs'
import { t } from '../utils/i18n'

const UPSTREAM_URL = 'https://github.com/coolcoala/koala-clash'
const FORK_URL = 'https://github.com/Derpcrawler/noctur'
// GPL-3.0 credits: the whole chain the code comes from, newest first. Keep in sync with the About
// section in Settings (noctur.about.credits) and `copyright` in electron-builder.yml.
const FORK_NOTICE = `Modified version of Koala Clash by coolcoala (${UPSTREAM_URL}), which builds on Sparkle by xishang0128 (https://github.com/xishang0128/sparkle) and Mihomo Party by pompurin404 (https://github.com/mihomo-party-org/mihomo-party). Licensed under GPL-3.0.`

export async function createApplicationMenu(): Promise<void> {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }

  const { quitWithoutCoreShortcut = '', restartAppShortcut = '' } = await getAppConfig()

  // GPL-3.0 section 5: the modified version says it was changed and names the original.
  app.setAboutPanelOptions({ credits: FORK_NOTICE })

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Noctur',
      submenu: [
        {
          label: t('menu.about') + ' ' + 'Noctur',
          role: 'about'
        },
        { type: 'separator' },
        // Noctur: Settings in the standard macOS place, with the standard shortcut.
        {
          label: t('menu.settings'),
          accelerator: 'Command+,',
          click: async (): Promise<void> => {
            await openMainWindowPage('/settings')
          }
        },
        { type: 'separator' },
        {
          label: t('menu.hide') + ' ' + 'Noctur',
          accelerator: 'Command+H',
          role: 'hide'
        },
        {
          label: t('menu.hideOthers'),
          accelerator: 'Command+Alt+H',
          role: 'hideOthers'
        },
        {
          label: t('menu.showAll'),
          role: 'unhide'
        },
        { type: 'separator' },
        ...(FORK.keepCore
          ? [
              {
                label: t('menu.quitKeepCore'),
                accelerator: quitWithoutCoreShortcut,
                click: (): void => {
                  quitWithoutCore()
                }
              }
            ]
          : []),
        {
          label: t('menu.restartApp'),
          accelerator: restartAppShortcut,
          click: () => {
            app.relaunch()
            app.quit()
          }
        },
        {
          label: t('menu.quitApp'),
          accelerator: 'Command+Q',
          click: () => {
            app.quit()
          }
        }
      ]
    },
    {
      label: t('menu.edit'),
      submenu: [
        {
          label: t('menu.undo'),
          accelerator: 'CmdOrCtrl+Z',
          role: 'undo'
        },
        {
          label: t('menu.redo'),
          accelerator: 'Shift+CmdOrCtrl+Z',
          role: 'redo'
        },
        { type: 'separator' },
        {
          label: t('menu.cut'),
          accelerator: 'CmdOrCtrl+X',
          role: 'cut'
        },
        {
          label: t('menu.copy'),
          accelerator: 'CmdOrCtrl+C',
          role: 'copy'
        },
        {
          label: t('menu.paste'),
          accelerator: 'CmdOrCtrl+V',
          role: 'paste'
        },
        {
          label: t('menu.selectAll'),
          accelerator: 'CmdOrCtrl+A',
          role: 'selectAll'
        }
      ]
    },
    {
      label: t('menu.window'),
      submenu: [
        {
          label: t('menu.minimize'),
          accelerator: 'CmdOrCtrl+M',
          role: 'minimize'
        },
        {
          label: t('menu.close'),
          accelerator: 'CmdOrCtrl+W',
          role: 'close'
        },
        { type: 'separator' },
        {
          label: t('menu.bringAllToFront'),
          role: 'front'
        }
      ]
    },
    {
      label: t('menu.help'),
      submenu: [
        {
          label: t('menu.learnMore'),
          click: () => {
            shell.openExternal(UPSTREAM_URL)
          }
        },
        {
          label: t('menu.reportIssue'),
          click: () => {
            shell.openExternal(`${FORK_URL}/issues`)
          }
        },
        { type: 'separator' },
        // Noctur: the folders from the removed Tools menu that help when reporting a problem.
        // Developer tools stay reachable by pressing F12 five times (renderer main.tsx).
        {
          label: t('menu.showLogs'),
          click: () => shell.openPath(logDir())
        },
        {
          label: t('menu.showAppData'),
          click: () => shell.openPath(dataDir())
        }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

export async function updateApplicationMenu(): Promise<void> {
  if (process.platform === 'darwin') {
    await createApplicationMenu()
  }
}
