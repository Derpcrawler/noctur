import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useConnectionsStore } from '@renderer/store/connections-store'

// Noctur: the apps with the most traffic over their open connections, as a short ranked list with
// thin bars (Home). The first bar takes the accent, the rest stay neutral. Beside the group list it
// is as tall as the list and shows as many apps as `limit` allows.

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0)} ${units[i]}`
}

export function appName(c: ControllerConnectionDetail): string {
  return c.metadata.process || c.metadata.host || c.metadata.destinationIP || '?'
}

const TopApps: React.FC<{ limit?: number }> = ({ limit = 4 }) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const active = useConnectionsStore((s) => s.active)
  const top = useMemo(() => {
    const by = new Map<string, number>()
    for (const c of active) by.set(appName(c), (by.get(appName(c)) ?? 0) + c.upload + c.download)
    return [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)
  }, [active, limit])
  const max = top[0]?.[1] || 1

  return (
    <section className="noctur-card nh-apps">
      <div className="nh-head">
        <span>{t('noctur.home.topApps')}</span>
        <button type="button" className="nh-link" onClick={() => navigate('/connections')}>
          {t('noctur.home.all')}
        </button>
      </div>
      <div className="nh-applist">
        {top.length === 0 ? (
          <span className="nh-muted">{t('noctur.home.noConnections')}</span>
        ) : (
          top.map(([name, bytes]) => (
            <div key={name} className="nh-app">
              <div>
                <span>{name}</span>
                <span>{formatBytes(bytes)}</span>
              </div>
              <div className="nh-appbar">
                <i style={{ width: `${Math.max(2, Math.round((bytes / max) * 100))}%` }} />
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  )
}

export default TopApps
