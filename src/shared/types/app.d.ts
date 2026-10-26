interface AppVersion {
  version: string
  changelog: string
  /** Noctur: the release page, and whether this platform has an installer in the release. */
  page?: string
  installable?: boolean
}

interface ISysProxyConfig {
  enable: boolean
  host?: string
  mode?: SysProxyMode
  bypass?: string[]
  pacScript?: string
  settingMode?: 'exec' | 'service'
}

interface IHost {
  domain: string
  value: string | string[]
}

interface AppConfig {
  core: 'mihomo' | 'system'
  // Noctur: ports the user set in Settings; the others follow the profile when it declares them
  customPorts?: MihomoPortKey[]
  systemCorePath?: string
  corePermissionMode?: 'elevated' | 'service'
  elevationDeclined?: boolean
  serviceAuthKey?: string
  disableLoopbackDetector: boolean
  disableEmbedCA: boolean
  disableSystemCA: boolean
  disableNftables: boolean
  safePaths: string[]
  proxyDisplayOrder: 'default' | 'delay' | 'name'
  proxyDisplayLayout: 'hidden' | 'single' | 'double'
  groupDisplayLayout: 'hidden' | 'single' | 'double'
  profileDisplayDate?: 'expire' | 'update'
  envType?: ('bash' | 'cmd' | 'powershell' | 'nushell')[]
  proxyCols: 'auto' | '1' | '2' | '3' | '4'
  connectionDirection: 'asc' | 'desc'
  connectionOrderBy: 'time' | 'upload' | 'download' | 'uploadSpeed' | 'downloadSpeed' | 'process'
  connectionListMode?: 'classic' | 'process'
  connectionViewMode?: 'list' | 'table'
  connectionTableColumns?: string[]
  connectionTableColumnWidths?: Record<string, number>
  connectionTableSortColumn?: string
  connectionTableSortDirection?: 'asc' | 'desc'
  connectionInterval?: number
  spinFloatingIcon?: boolean
  disableTray?: boolean
  showFloatingWindow?: boolean
  connectionCardStatus?: CardStatus
  dnsCardStatus?: CardStatus
  logCardStatus?: CardStatus
  pauseSSID?: string[]
  mihomoCoreCardStatus?: CardStatus
  profileCardStatus?: CardStatus
  proxyCardStatus?: CardStatus
  resourceCardStatus?: CardStatus
  ruleCardStatus?: CardStatus
  sniffCardStatus?: CardStatus
  sysproxyCardStatus?: CardStatus
  tunCardStatus?: CardStatus
  homeCardStatus?: CardStatus
  autoLightweight?: boolean
  autoLightweightDelay?: number
  autoLightweightMode?: 'core' | 'tray'
  mihomoCpuPriority?: Priority
  diffWorkDir?: boolean
  autoSetDNSMode?: 'none' | 'exec' | 'service'
  /** Upstream's single saved DNS; dropped on the next set or restore (noctur/system-dns.ts). */
  originDNS?: string
  /** Noctur: each network service's DNS before it was pointed into the tunnel ("Empty": DHCP). */
  originDNSByService?: Record<string, string>
  useWindowFrame: boolean
  proxyInTray: boolean
  appTheme: AppTheme
  // Noctur palette id, see src/renderer/src/noctur/palettes.ts
  palette?: string
  // Noctur: stars behind the window, and the jump animation on connect
  starField?: boolean
  // Noctur: version tag of the downloaded mihomo core in use; empty for the built-in one
  downloadedCore?: string
  connectJump?: boolean
  // Noctur: the look, 'noctur' (the moon and moving sky) or 'calm' (a power switch, still sky), and
  // whether it was chosen; the first-launch picker shows until it is.
  look?: 'noctur' | 'calm'
  lookChosen?: boolean
  customTheme?: string
  autoCheckUpdate: boolean
  /** Noctur: the window's language, for the main process at the next start. */
  language?: string
  /** Noctur: look for a newer version on GitHub (unset: on). */
  checkUpdates?: boolean
  silentStart: boolean
  autoCloseConnection: boolean
  expandProxyGroups?: boolean
  sysProxy: ISysProxyConfig
  proxyMode: boolean
  maxLogDays: number
  userAgent?: string
  delayTestConcurrency?: number
  delayTestUrl?: string
  delayTestTimeout?: number
  encryptedPassword?: number[]
  controlDns?: boolean
  controlSniff?: boolean
  controlTun?: boolean
  useDockIcon?: boolean
  useCustomTrayMenu?: boolean
  hosts: IHost[]
  showWindowShortcut?: string
  showFloatingWindowShortcut?: string
  triggerSysProxyShortcut?: string
  triggerTunShortcut?: string
  ruleModeShortcut?: string
  globalModeShortcut?: string
  directModeShortcut?: string
  restartAppShortcut?: string
  quitWithoutCoreShortcut?: string
  onlyActiveDevice?: boolean
  networkDetection?: boolean
  networkDetectionBypass?: string[]
  networkDetectionInterval?: number
  displayIcon?: boolean
  displayAppName?: boolean
  disableGPU: boolean
  mainSwitchMode?: 'tun' | 'sysproxy'
  useHotReloadProfile?: boolean
}

interface ProfileConfig {
  current?: string
  items: ProfileItem[]
}

interface ProfileItem {
  id: string
  type: 'remote' | 'local'
  name: string
  url?: string // remote
  ua?: string // remote
  agent?: 'noctur' | 'mihomo' | 'clashMeta' // remote: the User-Agent name that got a mihomo profile
  file?: string // local
  verify?: boolean // remote
  interval?: number
  home?: string
  homeName?: string
  updated?: number
  useProxy?: boolean
  extra?: SubscriptionUserInfo
  locked?: boolean
  autoUpdate?: boolean
  announce?: string
  logo?: string
  supportUrl?: string
  globalMode?: boolean
  expandProxyGroups?: boolean
  customCss?: string
}

interface SubscriptionUserInfo {
  upload: number
  download: number
  total: number
  expire: number
}
