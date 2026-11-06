import Eclipse from '@renderer/noctur/eclipse'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import BasePage from '@renderer/components/base/base-page'
import { useProfileConfig } from '@renderer/hooks/use-profile-config'
import { useGroups } from '@renderer/hooks/use-groups'
import { useTranslation } from 'react-i18next'
import { memo, useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import {
  WifiOff,
  PlusCircle,
  RefreshCcw,
  CalendarClock,
  CreditCard,
  ChevronDown
} from 'lucide-react'
import EditInfoModal from '@renderer/components/profiles/edit-info-modal'
import { Spinner } from '@renderer/components/ui/spinner'
import UpdateLine from '@renderer/noctur/update-line'
import { useTrafficStore } from '@renderer/store/traffic-store'
import { fixedBytes } from '@renderer/noctur/format'
import HomeGroups, { Delay, GroupNodes } from '@renderer/noctur/home-groups'
import HomeTiles from '@renderer/noctur/home-tiles'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useControledMihomoConfig } from '@renderer/hooks/use-controled-mihomo-config'
import TopApps from '@renderer/noctur/top-apps'
import { indexOf, lastDelay, routeOf } from '@renderer/noctur/route'
import { delayFor, useDelayMemory } from '@renderer/noctur/delays'
import { useConnection } from '@renderer/noctur/use-connection'

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0)} ${units[i]}`
}

// Days left at which the plan's numbers are replaced by the renewal notice
const EXPIRY_WARNING_DAYS = 3

// Module-level variable: persists across component mounts/unmounts
let connectionStartTime: number | null = null

const ConnectedTimer = memo(({ active }: { active: boolean }) => {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!active) {
      connectionStartTime = null
      setElapsed(0)
      return undefined
    }

    if (connectionStartTime === null) {
      connectionStartTime = Date.now()
    }

    const updateElapsed = (): void => {
      setElapsed(Math.floor((Date.now() - connectionStartTime!) / 1000))
    }
    updateElapsed()
    const interval = setInterval(updateElapsed, 1000)
    return () => clearInterval(interval)
  }, [active])

  const hours = Math.floor(elapsed / 3600)
  const minutes = Math.floor((elapsed % 3600) / 60)
  const seconds = elapsed % 60
  return (
    <time>
      {String(hours).padStart(2, '0')}:{String(minutes).padStart(2, '0')}:
      {String(seconds).padStart(2, '0')}
    </time>
  )
})
ConnectedTimer.displayName = 'ConnectedTimer'

const Home: React.FC = () => {
  const { t } = useTranslation()
  const { resolvedTheme } = useTheme()
  const light = resolvedTheme === 'light'
  const { profileConfig, addProfileItem } = useProfileConfig()
  const { groups = [] } = useGroups()
  const hasProfiles = (profileConfig?.items?.length ?? 0) > 0
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingItem, setEditingItem] = useState<ProfileItem | null>(null)
  const [updating, setUpdating] = useState(false)
  const [routeOpen, setRouteOpen] = useState(false)
  const trafficNow = useTrafficStore((st) => st.traffic)
  const conn = useConnection()
  const { appConfig } = useAppConfig()
  const { homeGroups = 'tiles', homeLayout = 'full', homeTraffic = true } = appConfig || {}
  const minimal = homeLayout === 'minimal'
  const { controledMihomoConfig } = useControledMihomoConfig()
  const global = controledMihomoConfig?.mode === 'global'

  const handleAddProfile = (): void => {
    const newProfile: ProfileItem = {
      id: '',
      name: '',
      type: 'remote',
      url: '',
      useProxy: false,
      autoUpdate: true
    }
    setEditingItem(newProfile)
    setShowEditModal(true)
  }

  const status = conn.busy
    ? conn.busy === 'connecting'
      ? t('pages.home.connecting')
      : t('pages.home.disconnecting')
    : conn.connected
      ? t('pages.home.connected')
      : t('pages.home.disconnected')
  const live = !conn.busy && conn.connected

  // Current profile & subscription
  const currentProfile = useMemo(() => {
    if (!profileConfig?.current || !profileConfig?.items) return null
    return profileConfig.items.find((item) => item.id === profileConfig.current) ?? null
  }, [profileConfig])

  const handleUpdateProfile = async (): Promise<void> => {
    if (!currentProfile || updating) return
    setUpdating(true)
    try {
      await addProfileItem(currentProfile)
    } catch (e) {
      toast.error(`${e}`)
    } finally {
      setUpdating(false)
    }
  }

  const subscription = currentProfile?.extra
  const trafficUsed = (subscription?.upload ?? 0) + (subscription?.download ?? 0)
  const trafficTotal = subscription?.total ?? 0
  const trafficRemaining = trafficTotal > 0 ? Math.max(0, trafficTotal - trafficUsed) : 0
  const usedShare = trafficTotal > 0 ? Math.min(1, trafficUsed / trafficTotal) : 0
  const expireTimestamp = subscription?.expire ?? 0
  const expireDate = expireTimestamp > 0 ? dayjs.unix(expireTimestamp).format('ll') : '∞'

  // Re-evaluate the countdown while the window stays open so the notice appears on time
  const [expiryTick, setExpiryTick] = useState(0)
  useEffect(() => {
    if (expireTimestamp <= 0) return undefined
    const interval = setInterval(() => setExpiryTick((n) => n + 1), 60_000)
    return () => clearInterval(interval)
  }, [expireTimestamp])

  const { daysRemaining, isExpired } = useMemo(() => {
    if (expireTimestamp <= 0) return { daysRemaining: 0, isExpired: false }
    const expiresAt = dayjs.unix(expireTimestamp)
    return {
      daysRemaining: Math.max(0, expiresAt.diff(dayjs(), 'day')),
      isExpired: expiresAt.isBefore(dayjs())
    }
  }, [expireTimestamp, expiryTick])

  const showExpiryNotice = expireTimestamp > 0 && daysRemaining <= EXPIRY_WARNING_DAYS
  const renewAction =
    currentProfile?.homeName && currentProfile?.home
      ? { url: currentProfile.home, label: currentProfile.homeName }
      : currentProfile?.supportUrl
        ? { url: currentProfile.supportUrl, label: t('pages.home.renewSubscription') }
        : null
  const expiryTitle = isExpired
    ? t('pages.home.subscriptionExpired')
    : daysRemaining === 0
      ? t('pages.home.subscriptionExpiringToday')
      : t('pages.home.subscriptionExpiring', { count: daysRemaining })

  const supportUrl = currentProfile?.supportUrl
  const supportHref = useMemo(() => {
    if (!supportUrl) return null
    try {
      return new URL(supportUrl).toString()
    } catch {
      return null
    }
  }, [supportUrl])

  // "Updated 5 min ago · every 6 h" under the plan's name (remote profiles only).
  const updatedFromNow =
    currentProfile?.type === 'remote' && currentProfile.updated
      ? dayjs(currentProfile.updated).fromNow()
      : null
  const interval = currentProfile?.type === 'remote' ? (currentProfile.interval ?? 0) : 0
  const intervalLabel =
    interval <= 0
      ? null
      : interval >= 1440
        ? `${Math.floor(interval / 1440)}${t('profile.dayShort')}`
        : interval >= 60
          ? `${Math.floor(interval / 60)}${t('profile.hourShort')}`
          : `${interval}${t('profile.minuteShort')}`

  const firstGroup = groups[0]
  const index = useMemo(() => indexOf(groups), [groups])
  const route = firstGroup ? routeOf(groups, firstGroup, index) : null
  // Remember every delay the core reports, so a later refresh without history keeps the number.
  const memory = useDelayMemory((s) => s.delays)
  const merge = useDelayMemory((s) => s.merge)
  useEffect(() => {
    const found: Record<string, number> = {}
    index.forEach((p, name) => {
      const d = lastDelay(p)
      if (d >= 0) found[name] = d
    })
    merge(found)
  }, [index, merge])
  // The server's protocol, unless its name already says it ("Amsterdam Hysteria2"), with or without
  // the version ("London Hysteria" for Hysteria2).
  const serverType =
    route &&
    route.server.type &&
    !route.server.name.toLowerCase().includes(route.server.type.toLowerCase().replace(/\d+$/, ''))
      ? route.server.type
      : ''

  // The route's names: the main group's selection, and when that is a group, the server it uses now
  // after it as "group: server", the server in bold. No joining word such as "via" is used, because
  // names can contain it themselves ("Fastest via London via Paris").
  const routeNames = !route ? null : route.server.name === route.selection ? (
    <b>{route.selection}</b>
  ) : (
    <>
      <span className="nh-hint">{route.selection}:</span> <b>{route.server.name}</b>
    </>
  )

  // The plan and the update line, at the top of both Home layouts.
  const planCard = (
    <>
      {/* The plan: logo (the moon when the provider sends none), name, the numbers and the bar */}
      {currentProfile && (
        <section className="noctur-card nh-plan" data-guide="home-profile-header">
          <div className="nh-plan-row">
            <div className="nh-plan-id">
              <span className="nh-logo">
                {currentProfile.logo ? (
                  <img
                    src={currentProfile.logo}
                    alt=""
                    onError={(e) => {
                      ;(e.target as HTMLImageElement).style.display = 'none'
                    }}
                  />
                ) : (
                  <Eclipse
                    className="nh-logo-mark"
                    // A different moon from the sidebar's, so the plan does not repeat the app's mark.
                    moon={light ? 'day' : 'blue'}
                    light={light}
                  />
                )}
              </span>
              <div className="min-w-0">
                <div className="nh-plan-name">
                  <span className="truncate">{currentProfile.name}</span>
                  {currentProfile.type === 'remote' && (
                    <button
                      type="button"
                      className="nh-link"
                      onClick={handleUpdateProfile}
                      disabled={updating}
                    >
                      {updating ? (
                        <Spinner className="size-3" />
                      ) : (
                        <RefreshCcw className="size-3" />
                      )}
                      {t('common.update')}
                    </button>
                  )}
                </div>
                {currentProfile.announce && (
                  <div data-guide="home-profile-announce" className="nh-muted nh-announce">
                    {currentProfile.announce}
                  </div>
                )}
                {(updatedFromNow || intervalLabel || supportHref) && (
                  <div className="nh-muted nh-plan-meta">
                    {updatedFromNow && (
                      <span>{t('noctur.home.updated', { time: updatedFromNow })}</span>
                    )}
                    {intervalLabel && (
                      <span>{t('noctur.profile.every', { interval: intervalLabel })}</span>
                    )}
                    {supportHref && (
                      <button
                        data-guide="home-support-link"
                        type="button"
                        className="nh-underline"
                        onClick={() => open(supportHref)}
                      >
                        {t('pages.profiles.support')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
            {subscription && !showExpiryNotice && (
              <>
                <div className="nh-plan-stat">
                  <span className="nh-muted">{t('noctur.home.trafficLeft')}</span>
                  <b>
                    {trafficTotal > 0 ? (
                      <>
                        {formatBytes(trafficRemaining)}
                        <span className="nh-pct">{Math.round((1 - usedShare) * 100)}%</span>
                      </>
                    ) : (
                      '∞'
                    )}
                  </b>
                </div>
                <div className="nh-plan-stat">
                  <span className="nh-muted">
                    {expireTimestamp > 0
                      ? t('noctur.home.daysLeft', { count: daysRemaining })
                      : t('noctur.home.plan')}
                  </span>
                  <b>{expireDate}</b>
                </div>
              </>
            )}
          </div>
          {subscription && !showExpiryNotice && trafficTotal > 0 && (
            <>
              <div className="nh-bar">
                <i style={{ width: `${usedShare * 100}%` }} />
              </div>
              <div className="nh-muted">
                {t('noctur.home.used', {
                  used: formatBytes(trafficUsed),
                  total: formatBytes(trafficTotal)
                })}
              </div>
            </>
          )}
          {subscription && showExpiryNotice && (
            <div role="status" className="noctur-expiry">
              <div className="noctur-expiry-icon">
                <CalendarClock className="size-5" aria-hidden />
              </div>
              <div className="min-w-0 grow">
                <p className="noctur-expiry-title">{expiryTitle}</p>
                <p className="noctur-expiry-hint">
                  {isExpired
                    ? t('pages.home.subscriptionExpiredHint')
                    : t('pages.home.subscriptionExpiringHint', { date: expireDate })}
                </p>
              </div>
              {renewAction && (
                <button
                  type="button"
                  onClick={() => open(renewAction.url)}
                  className="noctur-btn primary"
                >
                  <CreditCard className="size-4 shrink-0" aria-hidden />
                  <span className="truncate">{renewAction.label}</span>
                </button>
              )}
            </div>
          )}
        </section>
      )}
      <UpdateLine />
    </>
  )

  return (
    <BasePage compactHeader>
      {!hasProfiles ? (
        <div className="noctur-empty">
          <div className="noctur-empty-icon">
            <WifiOff className="size-7" />
          </div>
          <h2>{t('pages.profiles.emptyTitle')}</h2>
          <p>{t('pages.profiles.emptyDescription')}</p>
          <button
            onClick={handleAddProfile}
            data-guide="home-add-profile-btn"
            className="noctur-btn primary"
          >
            <PlusCircle className="size-4" />
            {t('pages.profiles.addProfile')}
          </button>
          {showEditModal && editingItem && (
            <EditInfoModal
              item={editingItem}
              isCurrent={false}
              updateProfileItem={async (item: ProfileItem) => {
                await addProfileItem(item)
                setShowEditModal(false)
                setEditingItem(null)
              }}
              onClose={() => {
                setShowEditModal(false)
                setEditingItem(null)
              }}
            />
          )}
        </div>
      ) : minimal ? (
        // Minimal Home (Settings, Appearance): the plan on top, the connection in the middle with its
        // button, and the address and Traffic tiles in a row at the bottom, each of which can be off;
        // without Traffic, one line of live speeds and the method stays under the button.
        <div className="nm">
          {planCard}
          <div className="nm-main">
            <div className="nm-state">
              <span className={`nh-dot${live ? ' on' : ''}`} />
              <span key={status} className="noctur-fade">
                {status}
              </span>
            </div>
            <div className="nm-time">{live ? <ConnectedTimer active={live} /> : ' '}</div>
            {route ? (
              <button
                type="button"
                className="nh-route nm-route flag-emoji"
                title={t('noctur.home.showServers')}
                aria-expanded={routeOpen}
                onClick={() => setRouteOpen((o) => !o)}
              >
                {routeNames}
                <span className="nh-route-meta">
                  {'· '}
                  <Delay ms={delayFor(route.server.name, route.server.delay, memory)} live={live} />
                </span>
                <ChevronDown className="nh-route-chev" strokeWidth={2} aria-hidden />
              </button>
            ) : (
              <span className="nh-route nh-muted">{t('noctur.home.ready')}</span>
            )}
            {routeOpen && firstGroup && (
              <div className="noctur-card nm-servers">
                <GroupNodes group={firstGroup} groups={groups} live={live} />
              </div>
            )}
            <button
              type="button"
              data-guide="home-power-toggle"
              disabled={conn.disabled}
              onClick={conn.toggle}
              className={`nh-connect nm-connect${conn.connected && !conn.busy ? '' : ' primary'}`}
            >
              {conn.busy && <Spinner className="size-4" />}
              {(conn.busy ? conn.busy === 'connecting' : !conn.connected)
                ? t('noctur.home.connect')
                : t('noctur.home.disconnect')}
            </button>
            {!homeTraffic && (
              <div className="nm-line noctur-fixed">
                <span>
                  <i className="down">↓</i>
                  {fixedBytes(live ? trafficNow.down : 0, true)}
                </span>
                <span>
                  <i className="up">↑</i>
                  {fixedBytes(live ? trafficNow.up : 0, true)}
                </span>
                <span>{conn.method === 'tun' ? t('noctur.tun') : t('noctur.sysProxyShort')}</span>
              </div>
            )}
          </div>
          <HomeTiles
            live={live}
            global={global}
            server={route?.server.name ?? ''}
            traffic={homeTraffic}
          />
        </div>
      ) : (
        <div className="nh">
          {planCard}

          {/* The connection: state and time, the route to the server in use, the session, Connect */}
          <section className="nh-status">
            <div className="nh-status-title">
              <span className={`nh-dot${live ? ' on' : ''}`} />
              <span key={status} className="noctur-fade">
                {status}
              </span>
              {live && <ConnectedTimer active={live} />}
            </div>
            {route ? (
              <button
                type="button"
                className="nh-route flag-emoji"
                title={t('noctur.home.showServers')}
                aria-expanded={routeOpen}
                onClick={() => setRouteOpen((o) => !o)}
              >
                {routeNames}
                <span className="nh-route-meta">
                  {'· '}
                  {serverType && <>{serverType} · </>}
                  <Delay ms={delayFor(route.server.name, route.server.delay, memory)} live={live} />
                </span>
                <ChevronDown className="nh-route-chev" strokeWidth={2} aria-hidden />
              </button>
            ) : (
              <span className="nh-route nh-muted">{t('noctur.home.ready')}</span>
            )}
            <button
              type="button"
              data-guide="home-power-toggle"
              disabled={conn.disabled}
              onClick={conn.toggle}
              className={`nh-connect${conn.connected && !conn.busy ? '' : ' primary'}`}
            >
              {conn.busy && <Spinner className="size-4" />}
              {(conn.busy ? conn.busy === 'connecting' : !conn.connected)
                ? t('noctur.home.connect')
                : t('noctur.home.disconnect')}
            </button>
          </section>

          {/* The first group's servers, opened from the route line */}
          {routeOpen && firstGroup && (
            <div className="noctur-card">
              <GroupNodes group={firstGroup} groups={groups} live={live} />
            </div>
          )}

          <HomeTiles
            live={live}
            global={global}
            server={route?.server.name ?? ''}
            traffic={homeTraffic}
          />

          {groups.length > 0 &&
            (homeGroups === 'tiles' ? (
              <HomeGroups groups={groups} live={live} layout="tiles" />
            ) : (
              <div className="nh-cols">
                <HomeGroups groups={groups} live={live} layout="list" />
                {/* As tall as the list: list rows are 40 px, app rows about 38 */}
                <TopApps limit={Math.max(4, Math.min(12, Math.floor(groups.length * 1.05)))} />
              </div>
            ))}
        </div>
      )}
    </BasePage>
  )
}

export default Home
