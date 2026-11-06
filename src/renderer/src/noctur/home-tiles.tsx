import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDownUp, Globe, RefreshCcw, Wifi } from 'lucide-react'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import {
  HISTORY_LENGTH,
  useTrafficHistory,
  useTrafficStore,
  type SpeedSample
} from '@renderer/store/traffic-store'
import { fixedBytes } from './format'
import { placeOf, refreshAddress, useAddresses, type AddressInfo } from './addresses'

// Noctur: the row of tiles under the connection on Home: "Your IP", "Proxy IP" and Traffic. The
// address tiles look nothing up until the user allows it, here or in Settings, Appearance.

// "12.4 MB" without the padding fixedBytes keeps for steady widths.
const compact = (text: string): string => text.trim().replace(/\s+/g, ' ')

interface AddressProps {
  title: string
  icon: React.ReactNode
  info?: AddressInfo
  // Shown instead of an address: [the big line, the small line].
  note?: [string, string]
  busy: boolean
  onRefresh?: () => void
}

// The address, the IPv6 address under it when there is one (smaller and darker; its slot stays empty
// without one), the provider and the place, each on its own line. A click on either address copies it, with "Copied" in place of the
// provider for a moment.
function AddressTile({
  title,
  icon,
  info,
  note,
  busy,
  onRefresh
}: AddressProps): React.ReactElement {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return undefined
    const timer = setTimeout(() => setCopied(false), 1200)
    return () => clearTimeout(timer)
  }, [copied])
  const copy = (text: string): void => {
    void navigator.clipboard.writeText(text).then(() => setCopied(true))
  }
  return (
    <section className="noctur-card nh-tile nh-addr">
      <div className="nh-tile-head">
        <span className="nh-tile-icon">{icon}</span>
        <span>{title}</span>
        {onRefresh && (
          <button
            type="button"
            className={`nh-refresh${busy ? ' busy' : ''}`}
            title={t('noctur.home.checkAgain')}
            aria-label={t('noctur.home.checkAgain')}
            disabled={busy}
            onClick={onRefresh}
          >
            <RefreshCcw strokeWidth={1.5} />
          </button>
        )}
      </div>
      {info ? (
        <>
          <button
            type="button"
            className={`nh-ip nh-copy${busy ? ' dim' : ''}`}
            title={t('noctur.home.copy')}
            onClick={() => copy(info.ip)}
          >
            {info.ip}
          </button>
          {info.ipv6 ? (
            <button
              type="button"
              className="nh-ip6 nh-copy"
              title={t('noctur.home.copy')}
              onClick={() => copy(info.ipv6!)}
            >
              {info.ipv6}
            </button>
          ) : (
            <div className="nh-ip6" aria-hidden />
          )}
          <div className="nh-tile-line" aria-live="polite">
            {copied ? t('noctur.home.copied') : info.provider || ' '}
          </div>
          <div className="nh-muted nh-tile-line flag-emoji">{placeOf(info) || ' '}</div>
        </>
      ) : (
        <>
          {/* The same rows as with an address, so nothing moves when it arrives */}
          <div className="nh-ip dim">{note?.[0] ?? '–'}</div>
          <div className="nh-ip6" aria-hidden />
          <div className="nh-muted nh-tile-line">{note?.[1] || ' '}</div>
          <div className="nh-muted nh-tile-line"> </div>
        </>
      )}
    </section>
  )
}

// The last minute of download and upload as two filled curves on one scale from zero, in two shades of
// the accent (download the accent with the stronger fill,
// upload the lighter shade); the arrows above, in the same shades, say which is which. The core sends a
// sample about once a second, so the curves slide left continuously between samples (a CSS animation
// of one step, restarted at each sample, none with Reduce motion) instead of jumping. The scale only
// changes at powers of two, so the curves do not jump at every new peak. Pointing at the graph shows
// that second's speeds in place of the live ones and how long ago it was.
function curve(points: [number, number][]): string {
  // Monotone cubic (Fritsch and Carlson): smooth, and never above or below the samples, so a quiet
  // second does not dip under zero.
  const n = points.length
  if (n < 2) return ''
  const dx = points.slice(1).map((p, i) => p[0] - points[i][0])
  const slope = points.slice(1).map((p, i) => (p[1] - points[i][1]) / dx[i])
  const m = points.map((_, i) => {
    if (i === 0) return slope[0]
    if (i === n - 1) return slope[n - 2]
    return slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2
  })
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = 0
      m[i + 1] = 0
      continue
    }
    const a = m[i] / slope[i]
    const b = m[i + 1] / slope[i]
    const h = a * a + b * b
    if (h > 9) {
      const t = 3 / Math.sqrt(h)
      m[i] = t * a * slope[i]
      m[i + 1] = t * b * slope[i]
    }
  }
  let d = `M${points[0][0].toFixed(2)},${points[0][1].toFixed(2)}`
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i]
    const [x1, y1] = points[i + 1]
    const h = (x1 - x0) / 3
    d += `C${(x0 + h).toFixed(2)},${(y0 + m[i] * h).toFixed(2)} ${(x1 - h).toFixed(2)},${(y1 - m[i + 1] * h).toFixed(2)} ${x1.toFixed(2)},${y1.toFixed(2)}`
  }
  return d
}

const GRAPH_H = 32
const STILL =
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

function SpeedGraph({
  samples,
  seq,
  onPoint,
  height = GRAPH_H
}: {
  samples: SpeedSample[]
  seq: number
  onPoint: (i: number | null) => void
  height?: number
}): React.ReactElement {
  const GH = height
  const [hover, setHover] = useState<number | null>(null)
  const n = HISTORY_LENGTH
  const step = 100 / (n - 1)
  // The newest sample one step past the right edge; the slide brings it in over the next second.
  const offset = STILL ? 0 : step
  const start = n - samples.length
  const peak = Math.max(1, ...samples.map((p) => Math.max(p.down, p.up)))
  const max = 2 ** Math.ceil(Math.log2(peak * 1.1))
  const x = (i: number): number => (start + i) * step + offset
  const y = (v: number): number => GH - 1 - (v / max) * (GH - 3)
  const pts = (key: 'down' | 'up'): [number, number][] => samples.map((p, i) => [x(i), y(p[key])])
  const area = (key: 'down' | 'up'): string => {
    const c = curve(pts(key))
    return c ? `${c}L${x(samples.length - 1).toFixed(2)},${GH}L${x(0).toFixed(2)},${GH}Z` : ''
  }
  const point = (e: React.PointerEvent<HTMLDivElement>): void => {
    const box = e.currentTarget.getBoundingClientRect()
    const i = Math.round(((e.clientX - box.left) / box.width) * (n - 1)) - start
    const k = i >= 0 && i < samples.length ? i : null
    setHover(k)
    onPoint(k)
  }
  const leave = (): void => {
    setHover(null)
    onPoint(null)
  }
  return (
    <div
      className="nh-graph"
      style={{ height: GH }}
      onPointerMove={point}
      onPointerLeave={leave}
      aria-hidden
    >
      {samples.length > 1 && (
        // A new key at each sample restarts the one-step slide, which moves this whole element (an
        // SVG group's CSS transform does not animate).
        <svg
          key={seq}
          className={STILL ? 'nh-graph-plot' : 'nh-graph-plot nh-graph-slide'}
          style={{ ['--nh-step' as string]: `${-step}%` }}
          viewBox={`0 0 100 ${GH}`}
          preserveAspectRatio="none"
        >
          <path className="nh-graph-area up" d={area('up')} />
          <path className="nh-graph-area down" d={area('down')} />
          <path className="nh-graph-line up" d={curve(pts('up'))} />
          <path className="nh-graph-line down" d={curve(pts('down'))} />
        </svg>
      )}
      {hover !== null && (
        <span className="nh-graph-hair" style={{ left: `${x(hover) - offset}%` }} />
      )}
    </div>
  )
}

function TrafficTile({ live }: { live: boolean }): React.ReactElement {
  const { t } = useTranslation()
  const traffic = useTrafficStore((s) => s.traffic)
  const samples = useTrafficHistory((s) => s.samples)
  const seq = useTrafficHistory((s) => s.seq)
  const [pointed, setPointed] = useState<number | null>(null)
  const at = pointed !== null ? samples[pointed] : undefined
  const ago = pointed !== null ? samples.length - 1 - pointed : 0
  return (
    <section className="noctur-card nh-tile nh-traffic">
      <div className="nh-tile-head">
        <span className="nh-tile-icon">
          <ArrowDownUp strokeWidth={1.6} />
        </span>
        <span>{t('noctur.home.traffic')}</span>
      </div>
      <div className="nh-speeds noctur-fixed">
        <span>
          <i className="down" aria-hidden>
            ↓
          </i>
          {fixedBytes(at ? at.down : live ? traffic.down : 0, true)}
        </span>
        <span>
          <i className="up" aria-hidden>
            ↑
          </i>
          {fixedBytes(at ? at.up : live ? traffic.up : 0, true)}
        </span>
      </div>
      <div className="nh-muted nh-tile-line">
        {at
          ? t('noctur.home.secondsAgo', { count: ago })
          : t('noctur.home.sessionTotal', {
              total: compact(fixedBytes(traffic.downTotal + traffic.upTotal))
            })}
      </div>
      {/* Always there, flat while disconnected, so the tile keeps its height */}
      <SpeedGraph samples={samples} seq={seq} onPoint={setPointed} />
    </section>
  )
}

interface Props {
  live: boolean
  // Global mode: the core sends every request through the server, "Your IP" too.
  global: boolean
  // The server traffic leaves through now, which the proxied result is kept for.
  server: string
  // The Traffic tile ("Traffic on Home" in Settings, Appearance).
  traffic?: boolean
}

const HomeTiles: React.FC<Props> = ({ live, global, server, traffic = true }) => {
  const { t } = useTranslation()
  const { appConfig, patchAppConfig } = useAppConfig()
  const allowed = appConfig?.addressLookup
  // Until the settings have loaded the choice is unknown: the tiles wait instead of asking, so the
  // question does not flash up at every launch.
  const asking = !!appConfig && allowed === undefined
  const { direct, proxied, busy, failed } = useAddresses()

  // Look up what is missing or old now, then check every minute while Home is open. The proxied lookup
  // waits a second, for the route to be ready after connecting or switching servers.
  useEffect(() => {
    if (allowed !== true) return undefined
    const direct = (): void => {
      if (!global) void refreshAddress('direct')
    }
    const viaProxy = (): void => {
      if (live && server) void refreshAddress('proxied', server)
    }
    direct()
    const first = setTimeout(viaProxy, 1000)
    const every = setInterval(() => {
      direct()
      viaProxy()
    }, 60_000)
    return () => {
      clearTimeout(first)
      clearInterval(every)
    }
  }, [allowed, live, global, server])

  const pending = (kind: 'direct' | 'proxied'): [string, string] =>
    failed[kind] && !busy[kind]
      ? [t('noctur.home.couldNotCheck'), t('noctur.home.tryAgainHint')]
      : [t('noctur.home.checking'), ' ']

  if (allowed === false) {
    if (!traffic) return null
    return (
      <div className="nh-tiles one">
        <TrafficTile live={live} />
      </div>
    )
  }

  return (
    <div className={traffic ? 'nh-tiles' : 'nh-tiles two'}>
      {asking ? (
        <section className="noctur-card nh-tile nh-addr nh-ask">
          <div className="nh-tile-head">
            <span className="nh-tile-icon">
              <Globe strokeWidth={1.6} />
            </span>
            <span>{t('noctur.home.askTitle')}</span>
          </div>
          <p className="nh-muted">{t('noctur.home.askText')}</p>
          <div className="nh-ask-actions">
            <button
              type="button"
              className="noctur-btn primary"
              onClick={() => patchAppConfig({ addressLookup: true })}
            >
              {t('noctur.home.askYes')}
            </button>
            <button
              type="button"
              className="noctur-btn"
              onClick={() => patchAppConfig({ addressLookup: false })}
            >
              {t('noctur.home.askNo')}
            </button>
          </div>
        </section>
      ) : (
        <>
          <AddressTile
            title={t('noctur.home.yourIp')}
            icon={<Wifi strokeWidth={1.6} />}
            info={global ? undefined : direct?.info}
            note={global ? ['–', t('noctur.home.inGlobal')] : pending('direct')}
            busy={busy.direct}
            onRefresh={global ? undefined : () => void refreshAddress('direct', '', true)}
          />
          <AddressTile
            title={t('noctur.home.proxyIp')}
            icon={<Globe strokeWidth={1.6} />}
            info={live ? proxied[server]?.info : undefined}
            note={live ? pending('proxied') : ['–', t('noctur.home.whileConnected')]}
            busy={busy.proxied}
            onRefresh={
              live && server ? () => void refreshAddress('proxied', server, true) : undefined
            }
          />
        </>
      )}
      {traffic && <TrafficTile live={live} />}
    </div>
  )
}

export default HomeTiles
