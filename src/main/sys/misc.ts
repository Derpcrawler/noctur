import { exec, execFile, execSync, spawn } from 'child_process'
import { app, dialog, nativeTheme, shell } from 'electron'
import { readFile } from 'fs/promises'
import path from 'path'
import { promisify } from 'util'
import {
  dataDir,
  exePath,
  mihomoCorePath,
  profilePath,
  resourcesDir,
  resourcesFilesDir,
  taskDir
} from '../utils/dirs'
import { copyFileSync, writeFileSync } from 'fs'
import { t } from '../utils/i18n'

export function getFilePath(ext: string[]): string[] | undefined {
  return dialog.showOpenDialogSync({
    title: t('dialog.selectSubscriptionFile'),
    filters: [{ name: `${ext} file`, extensions: ext }],
    properties: ['openFile']
  })
}

export async function readTextFile(filePath: string): Promise<string> {
  return await readFile(filePath, 'utf8')
}

export function openFile(id: string): void {
  shell.openPath(profilePath(id))
}

export async function openUWPTool(): Promise<void> {
  const execFilePromise = promisify(execFile)
  const uwpToolPath = path.join(resourcesDir(), 'files', 'enableLoopback.exe')
  await execFilePromise(uwpToolPath)
}

export async function setupFirewall(): Promise<void> {
  const execPromise = promisify(exec)
  const appName = app.getName()
  // Noctur: rules carry the app's name and only those are replaced. Upstream removed rules
  // named "mihomo", "mihomo-alpha", "Sparkle" and "Mihomo Party", which belong to other apps.
  // The alpha core is not shipped; its rule is only removed.
  const coreRule = `${appName} mihomo`
  const alphaRule = `${appName} mihomo-alpha`
  const removeCommand = `
  $rules = @("${coreRule}", "${alphaRule}", "${appName}")
  foreach ($rule in $rules) {
    if (Get-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue) {
      Remove-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue
    }
  }
  `
  const createCommand = `
  New-NetFirewallRule -DisplayName "${coreRule}" -Direction Inbound -Action Allow -Program "${mihomoCorePath('mihomo')}" -Enabled True -Profile Any -ErrorAction SilentlyContinue
  New-NetFirewallRule -DisplayName "${appName}" -Direction Inbound -Action Allow -Program "${exePath()}" -Enabled True -Profile Any -ErrorAction SilentlyContinue
  `

  if (process.platform === 'win32') {
    await execPromise(removeCommand, { shell: 'powershell' })
    await execPromise(createCommand, { shell: 'powershell' })
  }
}

export function setNativeTheme(theme: 'system' | 'light' | 'dark'): void {
  nativeTheme.themeSource = theme
}

// Noctur: own task and helper names, so the app does not replace Koala Clash's task on a PC
// that has both. The helper is built from build/runner/ by scripts/prepare.mjs.
export const ELEVATE_TASK = 'noctur-run'

const elevateTaskXml = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers />
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>Parallel</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>false</AllowHardTerminate>
    <StartWhenAvailable>false</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>3</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>"${path.join(taskDir(), `${ELEVATE_TASK}.exe`)}"</Command>
      <Arguments>"${exePath()}"</Arguments>
    </Exec>
  </Actions>
</Task>
`

export function createElevateTaskSync(): void {
  const taskFilePath = path.join(taskDir(), `${ELEVATE_TASK}.xml`)
  writeFileSync(taskFilePath, Buffer.from(`\ufeff${elevateTaskXml}`, 'utf-16le'))
  copyFileSync(
    path.join(resourcesFilesDir(), `${ELEVATE_TASK}.exe`),
    path.join(taskDir(), `${ELEVATE_TASK}.exe`)
  )
  execSync(
    `%SystemRoot%\\System32\\schtasks.exe /create /tn "${ELEVATE_TASK}" /xml "${taskFilePath}" /f`
  )
}

export async function deleteElevateTask(): Promise<void> {
  try {
    execSync(`%SystemRoot%\\System32\\schtasks.exe /delete /tn "${ELEVATE_TASK}" /f`)
  } catch {
    // ignore
  }
}

export async function checkElevateTask(): Promise<boolean> {
  try {
    execSync(`%SystemRoot%\\System32\\schtasks.exe /query /tn "${ELEVATE_TASK}"`, { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

export function resetAppConfig(): void {
  if (process.platform === 'win32') {
    spawn(
      'cmd',
      [
        '/C',
        `"timeout /t 2 /nobreak >nul && rmdir /s /q "${dataDir()}" && start "" "${exePath()}""`
      ],
      {
        shell: true,
        detached: true
      }
    ).unref()
  } else {
    const script = `while kill -0 ${process.pid} 2>/dev/null; do
  sleep 0.1
done
  rm -rf '${dataDir()}'
  ${process.argv.join(' ')} & disown
exit
`
    spawn('sh', ['-c', `"${script}"`], {
      shell: true,
      detached: true,
      stdio: 'ignore'
    })
  }
  app.quit()
}
