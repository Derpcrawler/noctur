import { FORK } from '../fork'
import {
  appConfigPath,
  controledMihomoConfigPath,
  dataDir,
  logDir,
  mihomoTestDir,
  mihomoWorkDir,
  profileConfigPath,
  profilePath,
  profilesDir,
  resourcesFilesDir,
  rulesDir,
  themesDir
} from './dirs'
import {
  defaultConfig,
  defaultControledMihomoConfig,
  defaultProfile,
  defaultProfileConfig
} from './template'
import { stringifyYaml } from './yaml'
import { chmod, mkdir, writeFile, cp, rm, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { startPacServer } from '../resolve/server'
import { triggerSysProxy } from '../sys/sysproxy'
import {
  getAppConfig,
  getControledMihomoConfig,
  patchAppConfig,
  patchControledMihomoConfig
} from '../config'
import { app } from 'electron'
import { pickLanguage, setLanguage } from './i18n'
import { startSSIDCheck } from '../sys/ssid'
import { startNetworkDetection } from '../core/manager'
import { initResumeRecovery } from '../sys/resume'
import { initKeyManager } from '../service/manager'
import { migrateFromOldApp } from './migration'
import { PORT_KEYS } from '../core/factory'

async function initDirs(): Promise<void> {
  if (!existsSync(dataDir())) {
    await mkdir(dataDir())
  }
  // Noctur: profiles and the config hold subscription links and the service's signing key.
  if (process.platform !== 'win32') await chmod(dataDir(), 0o700).catch(() => {})
  const dirs = [themesDir(), profilesDir(), rulesDir(), mihomoWorkDir(), logDir(), mihomoTestDir()]
  await Promise.all(
    dirs.map(async (dir) => {
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true })
      }
    })
  )
}

async function initConfig(): Promise<void> {
  const configTasks: Promise<void>[] = []

  if (!existsSync(appConfigPath())) {
    configTasks.push(writeFile(appConfigPath(), stringifyYaml(defaultConfig), { mode: 0o600 }))
  }
  if (!existsSync(profileConfigPath())) {
    configTasks.push(writeFile(profileConfigPath(), stringifyYaml(defaultProfileConfig)))
  }
  if (!existsSync(profilePath('default'))) {
    configTasks.push(writeFile(profilePath('default'), stringifyYaml(defaultProfile)))
  }
  if (!existsSync(controledMihomoConfigPath())) {
    configTasks.push(
      writeFile(controledMihomoConfigPath(), stringifyYaml(defaultControledMihomoConfig))
    )
  }

  if (configTasks.length > 0) {
    await Promise.all(configTasks)
  }
}

async function initFiles(): Promise<void> {
  const copy = async (file: string): Promise<void> => {
    const targetPath = path.join(mihomoWorkDir(), file)
    const testTargetPath = path.join(mihomoTestDir(), file)
    const sourcePath = path.join(resourcesFilesDir(), file)
    if (!existsSync(targetPath) && existsSync(sourcePath)) {
      await cp(sourcePath, targetPath, { recursive: true })
    }
    if (!existsSync(testTargetPath) && existsSync(sourcePath)) {
      await cp(sourcePath, testTargetPath, { recursive: true })
    }
  }
  await Promise.all([
    copy('country.mmdb'),
    copy('geoip.metadb'),
    copy('geoip.dat'),
    copy('geosite.dat'),
    copy('ASN.mmdb')
  ])
}

async function cleanup(): Promise<void> {
  // update cache
  const files = await readdir(dataDir())
  for (const file of files) {
    if (file.endsWith('.exe') || file.endsWith('.pkg') || file.endsWith('.7z')) {
      try {
        await rm(path.join(dataDir(), file))
      } catch {
        // ignore
      }
    }
  }
  // logs
  const { maxLogDays = 7 } = await getAppConfig()
  const logs = await readdir(logDir())
  for (const log of logs) {
    const date = new Date(log.split('.')[0])
    const diff = Date.now() - date.getTime()
    if (diff > maxLogDays * 24 * 60 * 60 * 1000) {
      try {
        await rm(path.join(logDir(), log))
      } catch {
        // ignore
      }
    }
  }
}

export async function migration(): Promise<void> {
  const appConfig = await getAppConfig()
  const mihomoConfig = await getControledMihomoConfig()

  const mihomoConfigPatch: Partial<MihomoConfig> = {}

  // Noctur: upstream turned TUN off here on every launch when controlTun was false. The app
  // still controls tun.enable in that case (core/factory.ts, config/controledMihomo.ts), so the
  // reset only threw away the user's TUN connection at each start.

  for (const key in defaultControledMihomoConfig) {
    if (
      !(key in mihomoConfig) &&
      defaultControledMihomoConfig[key as keyof MihomoConfig] !== undefined
    ) {
      ;(mihomoConfigPatch as Record<string, unknown>)[key] =
        defaultControledMihomoConfig[key as keyof MihomoConfig]
    }
  }

  // 清理已弃用的配置
  if (mihomoConfig['external-controller-pipe' as keyof MihomoConfig]) {
    mihomoConfigPatch['external-controller-pipe' as keyof MihomoConfig] = undefined as never
  }
  if (mihomoConfig['external-controller-unix' as keyof MihomoConfig]) {
    mihomoConfigPatch['external-controller-unix' as keyof MihomoConfig] = undefined as never
  }

  if (mihomoConfig['external-controller'] === undefined) {
    mihomoConfigPatch['external-controller'] = ''
  }

  if (Object.keys(mihomoConfigPatch).length > 0) {
    await patchControledMihomoConfig(mihomoConfigPatch)
  }

  const appConfigPatch: Partial<AppConfig> = {}

  // Noctur: ports now follow the profile unless set in Settings. A port saved with a value other
  // than the default was set by the user, so it stays theirs.
  if (appConfig.customPorts === undefined) {
    appConfigPatch.customPorts = PORT_KEYS.filter(
      (key) =>
        mihomoConfig[key] !== undefined && mihomoConfig[key] !== defaultControledMihomoConfig[key]
    )
  }

  for (const key in defaultConfig) {
    if (!(key in appConfig) && defaultConfig[key as keyof AppConfig] !== undefined) {
      ;(appConfigPatch as Record<string, unknown>)[key] = defaultConfig[key as keyof AppConfig]
    }
  }

  // Migrate: the old sysProxy.enable toggle now maps to the new proxyMode toggle.
  // sysProxy.enable becomes a sub-toggle (default ON) that only writes proxy to the OS.
  const legacyAppConfig = appConfig as Partial<AppConfig>
  if (!('proxyMode' in legacyAppConfig)) {
    appConfigPatch.proxyMode = legacyAppConfig.sysProxy?.enable ?? false
    if (!legacyAppConfig.sysProxy?.enable) {
      appConfigPatch.sysProxy = { ...(legacyAppConfig.sysProxy ?? {}), enable: true }
    }
  }

  if (Object.keys(appConfigPatch).length > 0) {
    await patchAppConfig(appConfigPatch)
  }
}

function initDeeplink(): void {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('clash', process.execPath, [path.resolve(process.argv[1])])
      app.setAsDefaultProtocolClient('mihomo', process.execPath, [path.resolve(process.argv[1])])
      app.setAsDefaultProtocolClient('noctur', process.execPath, [path.resolve(process.argv[1])])
    }
  } else {
    app.setAsDefaultProtocolClient('clash')
    app.setAsDefaultProtocolClient('mihomo')
    app.setAsDefaultProtocolClient('noctur')
  }
}

export async function init(): Promise<void> {
  await initDirs()
  await Promise.all([initConfig(), initFiles()])
  try {
    await migrateFromOldApp()
  } catch {
    // migration failure should not block app startup
  }
  await migration()

  const [appConfig] = await Promise.all([
    getAppConfig(),
    initKeyManager(),
    cleanup().catch(() => {
      // ignore
    })
  ])
  setLanguage(pickLanguage(appConfig.language, app.getPreferredSystemLanguages()))

  const {
    sysProxy,
    proxyMode = false,
    onlyActiveDevice = false,
    networkDetection = false
  } = appConfig
  const writeSysProxy = proxyMode && sysProxy.enable

  initResumeRecovery()

  const initTasks: Promise<void>[] = FORK.wifiDirect ? [startSSIDCheck()] : []

  if (networkDetection) {
    initTasks.push(startNetworkDetection())
  }

  initTasks.push(
    (async (): Promise<void> => {
      try {
        if (writeSysProxy) {
          await startPacServer()
        }
        await triggerSysProxy(writeSysProxy, onlyActiveDevice)
      } catch {
        // ignore
      }
    })()
  )

  await Promise.all(initTasks)

  initDeeplink()
}
