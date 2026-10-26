import { getAppConfig } from '../config'
import { getMixedPort } from '../core/factory'
import { pacPort, startPacServer, stopPacServer } from '../resolve/server'
import { promisify } from 'util'
import { execFile } from 'child_process'
import { servicePath } from '../utils/dirs'
import { net } from 'electron'
import { disableProxy, setPac, setProxy } from '../service/api'
import { t } from '../utils/i18n'
import { isShuttingDown } from './shutdown'

let defaultBypass: string[]
let triggerSysProxyTimer: NodeJS.Timeout | null = null
let triggerSysProxyTask: Promise<void> = Promise.resolve()
let triggerSysProxyRequest = 0

// Calls run one at a time in the order they were made, so a quick off then on cannot finish in the
// wrong order. Each call also cancels a pending offline retry, so an old "enable" retry cannot turn
// the proxy back on after the user disconnected. Taken from Sparkle 6831f93 and 5af4bff.
export function triggerSysProxy(enable: boolean, onlyActiveDevice: boolean): Promise<void> {
  // Noctur: once a quit is accepted, the proxy only goes off. An enable from the tray, a
  // shortcut or a start still in progress would run after the shutdown's disable and leave the
  // system pointing at the closed port.
  if (enable && isShuttingDown()) return Promise.resolve()
  const request = ++triggerSysProxyRequest
  if (triggerSysProxyTimer) {
    clearTimeout(triggerSysProxyTimer)
    triggerSysProxyTimer = null
  }
  const task = triggerSysProxyTask.then(() => applySysProxy(enable, onlyActiveDevice, request))
  triggerSysProxyTask = task.catch(() => {})
  return task
}

// Noctur: for callers that decide to enable the system proxy after waiting on something (wake
// recovery). A number that changes with every triggerSysProxy call, and an enable that happens only
// if no call was made since that number was read. The check and the enable run in one synchronous
// step, so a disconnect cannot slip in between.
export function sysProxyChangeCount(): number {
  return triggerSysProxyRequest
}

export function enableSysProxyUnlessChanged(since: number, onlyActiveDevice: boolean): Promise<boolean> {
  if (triggerSysProxyRequest !== since) return Promise.resolve(false)
  return triggerSysProxy(true, onlyActiveDevice).then(() => true)
}

async function applySysProxy(
  enable: boolean,
  onlyActiveDevice: boolean,
  request: number
): Promise<void> {
  // Noctur: turning the proxy off needs no network, so it never waits for one; a quit while
  // offline would otherwise exit before the retry and leave the system pointing at a closed port.
  if (!enable) {
    await disableSysProxy(onlyActiveDevice)
    return
  }
  if (net.isOnline()) {
    await setSysProxy(onlyActiveDevice)
  } else {
    // A newer call is already queued; it decides the final state.
    if (request !== triggerSysProxyRequest) return
    triggerSysProxyTimer = setTimeout(() => {
      triggerSysProxy(enable, onlyActiveDevice).catch(() => {})
    }, 5000)
  }
}

async function setSysProxy(onlyActiveDevice: boolean): Promise<void> {
  if (process.platform === 'linux')
    defaultBypass = [
      'localhost',
      '.local',
      '127.0.0.1/8',
      '192.168.0.0/16',
      '10.0.0.0/8',
      '172.16.0.0/12',
      '::1'
    ]
  if (process.platform === 'darwin')
    defaultBypass = [
      '127.0.0.1/8',
      '192.168.0.0/16',
      '10.0.0.0/8',
      '172.16.0.0/12',
      'localhost',
      '*.local',
      '*.crashlytics.com',
      '<local>'
    ]
  if (process.platform === 'win32')
    defaultBypass = [
      'localhost',
      '127.*',
      '192.168.*',
      '10.*',
      '172.16.*',
      '172.17.*',
      '172.18.*',
      '172.19.*',
      '172.20.*',
      '172.21.*',
      '172.22.*',
      '172.23.*',
      '172.24.*',
      '172.25.*',
      '172.26.*',
      '172.27.*',
      '172.28.*',
      '172.29.*',
      '172.30.*',
      '172.31.*',
      '<local>'
    ]
  await startPacServer()
  const { sysProxy } = await getAppConfig()
  const { mode, host, bypass = defaultBypass, settingMode = 'exec' } = sysProxy
  const port = await getMixedPort()
  const execFilePromise = promisify(execFile)
  const useService = process.platform === 'darwin' && settingMode === 'service'

  switch (mode || 'manual') {
    case 'auto': {
      if (useService) {
        try {
          await setPac(`http://${host || '127.0.0.1'}:${pacPort}/pac`, '', onlyActiveDevice)
        } catch {
          throw new Error(t('error.serviceMayNotInstalled'))
        }
      } else {
        await execFilePromise(servicePath(), [
          'sysproxy',
          'pac',
          '--url',
          `http://${host || '127.0.0.1'}:${pacPort}/pac`
        ])
      }
      break
    }

    case 'manual': {
      if (port != 0) {
        if (useService) {
          try {
            await setProxy(`${host || '127.0.0.1'}:${port}`, bypass.join(','), '', onlyActiveDevice)
          } catch {
            throw new Error(t('error.serviceMayNotInstalled'))
          }
        } else {
          await execFilePromise(servicePath(), [
            'sysproxy',
            'proxy',
            '--server',
            `${host || '127.0.0.1'}:${port}`,
            '--bypass',
            process.platform === 'win32' ? bypass.join(';') : bypass.join(',')
          ])
        }
      }
      break
    }
  }
}

export async function disableSysProxy(onlyActiveDevice: boolean): Promise<void> {
  await stopPacServer()
  const { sysProxy } = await getAppConfig()
  const { settingMode = 'exec' } = sysProxy
  const execFilePromise = promisify(execFile)
  const useService = process.platform === 'darwin' && settingMode === 'service'

  if (useService) {
    try {
      await disableProxy('', onlyActiveDevice)
    } catch (e) {
      throw new Error(t('error.serviceMayNotInstalled'))
    }
  } else {
    await execFilePromise(servicePath(), ['sysproxy', 'disable'])
  }
}
