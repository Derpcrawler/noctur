import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowLeftRight,
  FileText,
  Globe,
  House,
  Layers,
  Route,
  ScrollText,
  Settings,
  Waypoints,
  type LucideIcon
} from 'lucide-react'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useControledMihomoConfig } from '@renderer/hooks/use-controled-mihomo-config'
import { useProfileConfig } from '@renderer/hooks/use-profile-config'
import { useGroups } from '@renderer/hooks/use-groups'
import { useTrafficStore } from '@renderer/store/traffic-store'
import { useConnectionsStore } from '@renderer/store/connections-store'
import { mihomoCloseAllConnections, patchMihomoConfig } from '@renderer/utils/ipc'
import { fixedBytes } from './format'
import ConfigViewer from '@renderer/components/sider/config-viewer'
import Eclipse from './eclipse'
import { useConnection } from './use-connection'
import { useTheme } from 'next-themes'

// Noctur sidebar: always open, items with optional icons, mark and name on top; at the bottom the
// Rule/Global switch and the connection block (state and switch, TUN or Proxy, live speeds).
// Replaces components/app-sidebar.tsx.

const NAV: { key: string; path: string; label: string; icon: LucideIcon }[] = [
  { key: 'main', path: '/home', label: 'noctur.nav.home', icon: House },
  { key: 'proxy', path: '/proxies', label: 'noctur.nav.proxies', icon: Layers },
  { key: 'profile', path: '/profiles', label: 'noctur.nav.profiles', icon: FileText },
  {
    key: 'connection',
    path: '/connections',
    label: 'noctur.nav.connections',
    icon: ArrowLeftRight
  },
  { key: 'rule', path: '/rules', label: 'noctur.nav.rules', icon: Waypoints },
  { key: 'log', path: '/logs', label: 'noctur.nav.logs', icon: ScrollText },
  { key: 'settings', path: '/settings', label: 'noctur.nav.settings', icon: Settings }
]
const WITHOUT_PROFILES = new Set(['main', 'profile', 'settings'])
// Sub-pages highlight the item they are opened from.
const PARENT: Record<string, string> = {
  '/mihomo': '/settings',
  '/tun': '/settings',
  '/sysproxy': '/settings',
  '/dns': '/settings',
  '/sniffer': '/settings',
  '/resources': '/rules'
}

const NocturSidebar: React.FC = () => {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const [showRuntimeConfig, setShowRuntimeConfig] = useState(false)

  // The app menu's Settings item (main/resolve/menu.ts) opens a page by path.
  useEffect(() => {
    const go = (_e: unknown, path: unknown): void => {
      if (typeof path === 'string' && path.startsWith('/')) navigate(path)
    }
    window.electron.ipcRenderer.on('nocturNavigate', go)
    return (): void => {
      window.electron.ipcRenderer.removeListener('nocturNavigate', go)
    }
  }, [navigate])
  const { appConfig } = useAppConfig()
  const { resolvedTheme } = useTheme()
  const light = resolvedTheme === 'light'
  const { controledMihomoConfig, patchControledMihomoConfig } = useControledMihomoConfig()
  const { profileConfig } = useProfileConfig()
  const { mutate: mutateGroups } = useGroups()
  const traffic = useTrafficStore((s) => s.traffic)
  const activeConnections = useConnectionsStore((s) => s.active.length)
  const conn = useConnection()

  const { autoCloseConnection = true, navIcons = true } = appConfig || {}
  const { mode } = controledMihomoConfig || {}
  const hasProfiles = (profileConfig?.items?.length ?? 0) > 0
  const current = profileConfig?.items?.find((i) => i.id === profileConfig.current)
  const showMode = hasProfiles && current?.globalMode !== false && !!mode
  const items = hasProfiles ? NAV : NAV.filter((n) => WITHOUT_PROFILES.has(n.key))
  const activePath = PARENT[location.pathname] ?? location.pathname
  const on = conn.busy ? conn.busy === 'connecting' : conn.connected
  const state = conn.busy
    ? conn.busy === 'connecting'
      ? t('pages.home.connecting')
      : t('pages.home.disconnecting')
    : conn.connected
      ? t('noctur.connected')
      : t('noctur.disconnected')

  const changeMode = async (next: OutboundMode): Promise<void> => {
    await patchControledMihomoConfig({ mode: next })
    await patchMihomoConfig({ mode: next })
    if (autoCloseConnection) await mihomoCloseAllConnections()
    mutateGroups()
    window.electron.ipcRenderer.send('updateTrayMenu')
  }

  return (
    <aside className="noctur-side" data-guide="app-sidebar">
      <div className="noctur-side-top app-drag" />
      <div className="noctur-brand">
        {/* The eclipse mark: the earthshine moon on dark, the blue moon on light */}
        <Eclipse className="noctur-brand-mark" moon={light ? 'blue' : 'earthshine'} light={light} />
        <span>Noctur</span>
      </div>
      <nav className="noctur-nav">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            aria-current={activePath.includes(item.path) ? 'page' : undefined}
            data-guide={item.key === 'main' ? 'sidebar-home-button' : undefined}
            onClick={() => navigate(item.path)}
            onDoubleClick={item.key === 'profile' ? () => setShowRuntimeConfig(true) : undefined}
          >
            {navIcons && <item.icon className="noctur-nav-icon" strokeWidth={1.5} aria-hidden />}
            <span>{t(item.label)}</span>
            {item.key === 'connection' && activeConnections > 0 && (
              <span className="noctur-count">{activeConnections}</span>
            )}
          </button>
        ))}
      </nav>
      <div className="noctur-side-foot">
        {showMode && (
          <div className="noctur-mode" role="group" aria-label="Rule or Global">
            {(
              [
                { value: 'rule', icon: Route, label: t('noctur.rule') },
                { value: 'global', icon: Globe, label: t('noctur.global') }
              ] as const
            ).map(({ value, icon: Icon, label }) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => mode !== value && changeMode(value)}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="noctur-conn">
          <div className="noctur-conn-top">
            <span className="noctur-conn-state">{state}</span>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-label={conn.connected ? t('noctur.home.disconnect') : t('noctur.home.connect')}
              disabled={conn.disabled}
              className={`noctur-switch${conn.busy ? ' busy' : ''}`}
              onClick={conn.toggle}
            >
              <i />
            </button>
          </div>
          <div className="noctur-seg" role="group" aria-label={t('noctur.home.method')}>
            {(['tun', 'sysproxy'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={conn.method === m}
                disabled={!!conn.busy || (m === 'sysproxy' && conn.connected && conn.proxyUnusable)}
                onClick={() => conn.changeMethod(m)}
              >
                {m === 'tun' ? t('noctur.tun') : t('noctur.sysProxyShort')}
              </button>
            ))}
          </div>
          <div className="noctur-conn-rate noctur-fixed">
            <span>
              <i aria-hidden>↓</i>
              {fixedBytes(conn.connected ? traffic.down : 0, true)}
            </span>
            <span>
              <i aria-hidden>↑</i>
              {fixedBytes(conn.connected ? traffic.up : 0, true)}
            </span>
          </div>
        </div>
      </div>
      {showRuntimeConfig && <ConfigViewer onClose={() => setShowRuntimeConfig(false)} />}
    </aside>
  )
}

export default NocturSidebar
