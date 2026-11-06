import React, { useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { MousePointerClick, Route as RouteIcon, Scale, Shield, Zap } from 'lucide-react'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useGroups } from '@renderer/hooks/use-groups'
import { mihomoChangeProxy, mihomoCloseAllConnections, mihomoGroupDelay } from '@renderer/utils/ipc'
import { Spinner } from '@renderer/components/ui/spinner'
import { indexOf, lastDelay, routeOf } from './route'
import { autoTest, delayFor, useDelayMemory } from './delays'
import { delayTone } from './delay-tone'

// Noctur: the proxy groups on Home, the main group first (in the list as well as on
// the connection line, which opens it too). Each group shows its own selection under its name and
// the delay of the server it ends on; a group opens in place to switch the server (Selector groups
// only, as on the Proxy Groups page). Switching
// closes only the group's connections when "Auto close connections" is on. As a list (the default) or
// as tiles (Settings, Appearance).

const TYPE_ICON: Record<string, React.ReactNode> = {
  Selector: <MousePointerClick strokeWidth={1.5} />,
  URLTest: <Zap strokeWidth={1.5} />,
  Fallback: <Shield strokeWidth={1.5} />,
  LoadBalance: <Scale strokeWidth={1.5} />,
  Relay: <RouteIcon strokeWidth={1.5} />
}

export function Delay({ ms, live = true }: { ms: number; live?: boolean }): React.ReactElement {
  const { t } = useTranslation()
  if (!live || ms < 0) return <span className="nh-ms">–</span>
  if (ms === 0) return <span className="nh-ms nh-timeout">{t('noctur.home.timeout')}</span>
  return <span className={`nh-ms ${delayTone(ms)}`}>{ms} ms</span>
}

function GroupIcon({ group }: { group: ControllerMixedGroup }): React.ReactElement {
  if (group.icon) {
    const src = group.icon.startsWith('<svg')
      ? `data:image/svg+xml;utf8,${group.icon}`
      : localStorage.getItem(group.icon) || group.icon
    return <img className="nh-ico" alt="" src={src} />
  }
  return <span className="nh-ico">{TYPE_ICON[group.type] ?? <Zap strokeWidth={1.5} />}</span>
}

type Member = { name: string; now?: string; history?: { delay: number }[] }

// Delays as Home shows them: the core's latest, or the last one seen (delays.ts); a member that is a
// group stands for the server it uses now.
function useDelays(groups: ControllerMixedGroup[]): (p: Member) => number {
  const index = useMemo(() => indexOf(groups), [groups])
  const memory = useDelayMemory((s) => s.delays)
  return (p) => {
    const entry = index.get(p.name) ?? p
    if (entry.now === undefined) return delayFor(p.name, lastDelay(p), memory)
    const { server } = routeOf(groups, { type: '', ...entry }, index)
    return delayFor(server.name, server.delay, memory)
  }
}

// Scrolls `page` to `top` over 420 ms, easing in and out; at once with Reduce motion.
function easeScroll(page: HTMLElement, top: number): void {
  const from = page.scrollTop
  const to = Math.max(0, Math.min(top, page.scrollHeight - page.clientHeight))
  if (Math.abs(to - from) < 1) return
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    page.scrollTop = to
    return
  }
  const start = performance.now()
  const step = (now: number): void => {
    const k = Math.min(1, (now - start) / 420)
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
    page.scrollTop = from + (to - from) * e
    if (k < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

// A group's servers, to switch from Home.
export function GroupNodes({
  group,
  groups,
  live
}: {
  group: ControllerMixedGroup
  groups: ControllerMixedGroup[]
  live: boolean
}): React.ReactElement {
  const { appConfig } = useAppConfig()
  const { autoCloseConnection = true } = appConfig || {}
  const { mutate } = useGroups()
  const delayOf = useDelays(groups)

  const choose = async (node: string): Promise<void> => {
    if (group.type !== 'Selector' || node === group.now) return
    try {
      await mihomoChangeProxy(group.name, node)
      if (autoCloseConnection) await mihomoCloseAllConnections(group.name)
      mutate()
      window.electron.ipcRenderer.send('updateTrayMenu')
    } catch (e) {
      toast.error(`${e}`)
    }
  }

  return (
    <div className="nh-nodes flag-emoji">
      {group.all.map((n) => (
        <button
          key={n.name}
          type="button"
          className="nh-node"
          aria-current={n.name === group.now}
          disabled={group.type !== 'Selector'}
          onClick={() => choose(n.name)}
        >
          <span>{n.name}</span>
          <Delay ms={delayOf(n)} live={live} />
        </button>
      ))}
    </div>
  )
}

// Four groups at a time, so a subscription with many groups does not start hundreds of tests at once.
function useTestAll(groups: ControllerMixedGroup[]): {
  testing: boolean
  testAll: () => Promise<void>
} {
  const { mutate } = useGroups()
  const merge = useDelayMemory((s) => s.merge)
  const index = useMemo(() => indexOf(groups), [groups])
  const [testing, setTesting] = useState(false)
  const testAll = async (): Promise<void> => {
    setTesting(true)
    try {
      for (let i = 0; i < groups.length; i += 4) {
        await Promise.allSettled(
          groups.slice(i, i + 4).map(async (g) => {
            const result = await mihomoGroupDelay(g.name, g.testUrl)
            // A member missing from the answer timed out; a member that is a group stands
            // for the server it uses now.
            const found: Record<string, number> = {}
            for (const p of g.all) {
              const entry = index.get(p.name)
              const server =
                entry?.now !== undefined ? routeOf(groups, entry, index).server.name : p.name
              found[server] = result[p.name] ?? 0
            }
            merge(found)
          })
        )
      }
      mutate()
    } finally {
      setTesting(false)
    }
  }
  return { testing, testAll }
}

interface Props {
  groups: ControllerMixedGroup[]
  live: boolean
  layout: 'list' | 'tiles'
}

const HomeGroups: React.FC<Props> = ({ groups, live, layout }) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState<string | null>(null)
  const { testing, testAll } = useTestAll(groups)
  const delayOf = useDelays(groups)
  const rest = groups
  const opened = rest.find((g) => g.name === open)
  const tileRefs = useRef(new Map<string, HTMLDivElement>())

  useEffect(() => {
    if (!live || groups.length === 0 || autoTest.done) return
    autoTest.done = true
    void testAll()
  }, [live, groups.length])

  // A tile grows to the full width with its servers inside; the change animates as a view transition
  // (none with Reduce motion), then the page scrolls so the opened tile is in view.
  const toggle = (name: string): void => {
    const next = open === name ? null : name
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => { finished: Promise<void> }
    }
    // Only as far as shows the whole tile with 24 px to spare (to its top when it is taller than the
    // page), eased over 420 ms (scrolling only just into view barely moves, and centering jumps).
    const reveal = (): void => {
      const el = next ? tileRefs.current.get(next) : undefined
      const page = el?.closest('.noctur-content') as HTMLElement | null | undefined
      if (!el || !page) return
      const t = el.getBoundingClientRect()
      const p = page.getBoundingClientRect()
      let delta = Math.max(0, t.bottom - (p.bottom - 24))
      if (t.top - delta < p.top + 24) delta = t.top - (p.top + 24)
      easeScroll(page, page.scrollTop + delta)
    }
    if (
      layout !== 'tiles' ||
      !doc.startViewTransition ||
      matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setOpen(next)
      if (layout === 'tiles') requestAnimationFrame(reveal)
      return
    }
    doc.startViewTransition(() => flushSync(() => setOpen(next))).finished.then(reveal, reveal)
  }

  const head = (
    <div className="nh-head">
      <span>{t('noctur.home.groups')}</span>
      <button type="button" className="nh-link" disabled={testing} onClick={testAll}>
        {testing && <Spinner className="size-3" />}
        {t('noctur.home.testAll')}
      </button>
    </div>
  )

  if (layout === 'tiles') {
    return (
      <section className="nh-gtiles">
        {head}
        <div className="nh-gtile-grid">
          {rest.map((g, i) => (
            <div
              key={g.name}
              ref={(el) => {
                if (el) tileRefs.current.set(g.name, el)
                else tileRefs.current.delete(g.name)
              }}
              className="noctur-card nh-gtile flag-emoji"
              data-open={open === g.name || undefined}
              style={{ viewTransitionName: `nh-gtile-${i}` }}
            >
              <button
                type="button"
                className="nh-gtile-head"
                aria-expanded={open === g.name}
                onClick={() => toggle(g.name)}
              >
                <span className="nh-gtile-top">
                  <GroupIcon group={g} />
                  <Delay ms={delayOf(g)} live={live} />
                </span>
                <span className="nh-gtile-name">{g.name}</span>
                <span className="nh-muted nh-gtile-now">{g.now}</span>
              </button>
              {opened === g && <GroupNodes group={g} groups={groups} live={live} />}
            </div>
          ))}
        </div>
      </section>
    )
  }

  return (
    <section className="noctur-card nh-groups">
      {head}
      <div className="nh-rows">
        {rest.map((g) => (
          <React.Fragment key={g.name}>
            <button
              type="button"
              className="nh-row flag-emoji"
              aria-expanded={open === g.name}
              onClick={() => toggle(g.name)}
            >
              <GroupIcon group={g} />
              <span className="nh-row-text">
                <span>{g.name}</span>
                <span className="nh-muted">{g.now}</span>
              </span>
              <Delay ms={delayOf(g)} live={live} />
            </button>
            {open === g.name && <GroupNodes group={g} groups={groups} live={live} />}
          </React.Fragment>
        ))}
      </div>
    </section>
  )
}

export default HomeGroups
