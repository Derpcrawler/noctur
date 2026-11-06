import React, { useEffect, useId, useRef } from 'react'
import earthshine from '@renderer/assets/moon/earthshine.png'
import blue from '@renderer/assets/moon/blue.png'
import day from '@renderer/assets/moon/day.png'

// The Noctur eclipse: the moon with the sun rising at its top right edge, the same drawing as the
// app icon (design/brand). On Home it shows the connection state and plays the sunrise: a pale
// light pulses at the edge while connecting, the sun rises over 1.5 s once connected and sets in
// 0.6 s on disconnect. As the sidebar mark it is drawn connected and does not move.

export type EclipseState = 'off' | 'connecting' | 'on'
type Moon = 'earthshine' | 'blue' | 'day'
const TEXTURE: Record<Moon, string> = { earthshine, blue, day }

interface Props {
  state?: EclipseState
  moon?: Moon
  // Light mode: the corona is drawn in deeper blue so it reads on a light background.
  light?: boolean
  // Animate state changes; when off they are a short crossfade.
  animate?: boolean
  className?: string
}

const SX = 72.12
const SY = 32.51
const C = { x: 50, y: 48 }
const ANG = Math.atan2(SY - C.y, SX - C.x)
// The thin ring around the dim moon while disconnected.
const HALO = 0.1
// The moon's opacity while disconnected (at 0.55 it is nearly black).
const MOON_OFF = 0.7
const clamp = (v: number, a = 0, b = 1): number => Math.min(b, Math.max(a, v))
const ramp = (t: number, a: number, b: number): number => clamp((t - a) / (b - a))
const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3)
const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const bell = (t: number, a: number, p: number, b: number): number =>
  t < a || t > b ? 0 : t < p ? easeOut((t - a) / (p - a)) : 1 - easeInOut((t - p) / (b - p))

const Eclipse: React.FC<Props> = ({
  state = 'on',
  moon = 'earthshine',
  light = false,
  animate = true,
  className
}) => {
  const id = useId().replace(/:/g, '')
  const svgRef = useRef<SVGSVGElement>(null)
  // Sunrise progress (0 dark, 1 risen) and what is happening now.
  const anim = useRef({ p: state === 'on' ? 1 : 0, phase: state as string, start: 0, raf: 0 })

  // Writes one frame: p is the sunrise progress, pulse the pre-dawn light while connecting.
  const frame = (p: number, pulse: number, crossfade: boolean): void => {
    const svg = svgRef.current
    if (!svg) return
    const q = (k: string): SVGElement | null => svg.querySelector(`[data-k="${k}"]`)
    const set = (k: string, a: string, v: number): void => q(k)?.setAttribute(a, String(v))
    if (crossfade) {
      const e = easeInOut(p)
      for (const k of ['corona', 'warm', 'rim', 'beads', 'sun']) set(k, 'opacity', e)
      set('rise', 'opacity', 0)
      set('flare', 'opacity', 0)
      set('predawn', 'opacity', pulse * 0.5)
      set('haloOff', 'opacity', HALO * (1 - e))
      set('moon', 'opacity', MOON_OFF + (1 - MOON_OFF) * e)
      return
    }
    const d = 19 + 8.2 * easeOut(ramp(p, 0, 0.55))
    for (const k of ['riseHalo', 'riseCore']) {
      set(k, 'cx', C.x + d * Math.cos(ANG))
      set(k, 'cy', C.y + d * Math.sin(ANG))
    }
    set('rise', 'opacity', easeOut(ramp(p, 0, 0.35)) * (1 - ramp(p, 0.7, 0.9)))
    set('predawn', 'opacity', pulse * 0.55 * (1 - ramp(p, 0, 0.4)))
    const warm = easeOut(ramp(p, 0.15, 0.9))
    set('warm', 'opacity', warm)
    set('warm', 'r', 18 + 14 * warm)
    set('rim', 'opacity', easeInOut(ramp(p, 0.3, 0.8)))
    set('corona', 'opacity', easeInOut(ramp(p, 0.4, 1)))
    set('beads', 'opacity', easeOut(ramp(p, 0.6, 0.82)))
    set('sun', 'opacity', easeOut(ramp(p, 0.5, 0.75)))
    const f = bell(p, 0.72, 0.84, 1)
    set('flare', 'opacity', f * 0.75)
    set('flare', 'r', 4 + 4 * f)
    set('sunHalo', 'r', 11 * (1 + 0.3 * f))
    set('haloOff', 'opacity', HALO * (1 - ramp(p, 0, 0.5)))
    set('moon', 'opacity', MOON_OFF + (1 - MOON_OFF) * easeInOut(ramp(p, 0.2, 1)))
  }

  useEffect(() => {
    const a = anim.current
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const crossfade = !animate || reduce
    const from = a.phase
    cancelAnimationFrame(a.raf)
    a.start = performance.now()
    if (state === 'connecting') a.phase = 'connecting'
    else if (state === 'on')
      a.phase = from === 'connecting' || (from === 'off' && a.p < 1) ? 'rising' : 'on'
    else a.phase = from === 'connecting' ? 'fading' : a.p > 0 ? 'setting' : 'off'

    const startP = a.p
    const tick = (now: number): void => {
      const el = (now - a.start) / 1000
      let pulse = 0
      if (a.phase === 'connecting') {
        pulse =
          Math.min(1, el / 0.4) * (0.55 + 0.45 * (0.5 - 0.5 * Math.cos((el * Math.PI * 2) / 1.6)))
      } else if (a.phase === 'rising') {
        a.p = clamp(startP + el / (crossfade ? 0.35 : 1.5))
        pulse = 1 - a.p
        if (a.p >= 1) a.phase = 'on'
      } else if (a.phase === 'setting') {
        a.p = clamp(startP - el / (crossfade ? 0.3 : 0.6))
        if (a.p <= 0) a.phase = 'off'
      } else if (a.phase === 'fading') {
        pulse = Math.max(0, 1 - el / 0.5)
        if (pulse === 0) a.phase = 'off'
      }
      frame(a.p, pulse, crossfade)
      if (a.phase !== 'on' && a.phase !== 'off') a.raf = requestAnimationFrame(tick)
    }
    a.raf = requestAnimationFrame(tick)
    return (): void => cancelAnimationFrame(a.raf)
  }, [state, animate])

  // Light mode draws the corona and the dim moon's ring in deeper blue, behind a pale moon.
  const co = light
    ? ['#5B78D6', '#6F8FD8', 0.42, '#8FA8FF', 0.18, '#8F9CFF']
    : ['#9FC4FF', '#D3E2FF', 0.36, '#8FA8FF', 0.13, '#8F9CFF']
  const ref = (k: string): string => `url(#${id}${k})`
  const initial = state === 'on' ? 1 : 0
  return (
    <svg
      ref={svgRef}
      viewBox="0 0 100 100"
      className={className}
      aria-hidden="true"
      style={{ overflow: 'visible' }}
    >
      <defs>
        <radialGradient id={`${id}co`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0.6" stopColor={co[0] as string} stopOpacity="0" />
          <stop offset="0.655" stopColor={co[1] as string} stopOpacity={co[2]} />
          <stop offset="0.74" stopColor={co[3] as string} stopOpacity={co[4]} />
          <stop offset="1" stopColor={co[5] as string} stopOpacity="0" />
        </radialGradient>
        <linearGradient
          id={`${id}cg`}
          gradientUnits="userSpaceOnUse"
          x1={SX}
          y1={SY}
          x2="27.88"
          y2="63.49"
        >
          <stop offset="0" stopColor="#fff" />
          <stop offset="0.55" stopColor="#777" />
          <stop offset="1" stopColor="#222" />
        </linearGradient>
        <mask id={`${id}cm`} maskUnits="userSpaceOnUse" x="-20" y="-20" width="140" height="140">
          <rect x="-20" y="-20" width="140" height="140" fill={ref('cg')} />
        </mask>
        <radialGradient id={`${id}wg`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#FFE6BF" stopOpacity="0.7" />
          <stop offset="0.28" stopColor="#FFC08E" stopOpacity="0.3" />
          <stop offset="0.6" stopColor="#A08CFF" stopOpacity="0.08" />
          <stop offset="1" stopColor="#8F8CFF" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}pd`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#EEF3FF" stopOpacity="0.75" />
          <stop offset="0.4" stopColor="#C3D3FF" stopOpacity="0.3" />
          <stop offset="1" stopColor="#8FA8FF" stopOpacity="0" />
        </radialGradient>
        <linearGradient
          id={`${id}lg`}
          gradientUnits="userSpaceOnUse"
          x1="27.88"
          y1="63.49"
          x2={SX}
          y2={SY}
        >
          <stop offset="0" stopColor="#FFF3DD" stopOpacity="0" />
          <stop offset="0.45" stopColor="#FFF3DD" stopOpacity="0" />
          <stop offset="0.75" stopColor="#FFF3DD" stopOpacity="0.5" />
          <stop offset="1" stopColor="#FFFFFF" />
        </linearGradient>
        <mask id={`${id}lm`} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
          <rect width="100" height="100" fill="#000" />
          <circle cx="50" cy="48" r="27.4" fill="#fff" />
          <circle cx="50" cy="48" r="26.9" fill="#000" />
        </mask>
        <mask id={`${id}out`} maskUnits="userSpaceOnUse" x="-20" y="-20" width="140" height="140">
          <rect x="-20" y="-20" width="140" height="140" fill="#fff" />
          <circle cx="50" cy="48" r="26.9" fill="#000" />
        </mask>
        <radialGradient id={`${id}ha`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.18" stopColor="#FFF6E8" stopOpacity="0.75" />
          <stop offset="0.5" stopColor="#FFE2B8" stopOpacity="0.25" />
          <stop offset="1" stopColor="#FFD9A0" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}st`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.8" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}bd`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.5" stopColor="#FFF4E0" stopOpacity="0.6" />
          <stop offset="1" stopColor="#FFF4E0" stopOpacity="0" />
        </radialGradient>
        <clipPath id={`${id}mc`}>
          <circle cx="50" cy="48" r="27" />
        </clipPath>
      </defs>
      <circle
        data-k="corona"
        cx="50"
        cy="48"
        r="42"
        fill={ref('co')}
        mask={ref('cm')}
        opacity={initial}
      />
      <circle
        data-k="warm"
        cx={SX}
        cy={SY}
        r={initial ? 32 : 18}
        fill={ref('wg')}
        opacity={initial}
      />
      <circle data-k="predawn" cx={SX} cy={SY} r="12" fill={ref('pd')} opacity="0" />
      <circle
        data-k="haloOff"
        cx="50"
        cy="48"
        r="27.25"
        fill="none"
        stroke={light ? '#5B78D6' : '#8FA8FF'}
        strokeWidth="0.35"
        opacity={initial ? 0 : HALO}
      />
      <circle cx="50" cy="48" r="27" fill={light ? '#C9D5EE' : '#02030A'} />
      <image
        data-k="moon"
        href={TEXTURE[moon]}
        x="23"
        y="21"
        width="54"
        height="54"
        clipPath={ref('mc')}
        opacity={initial ? 1 : MOON_OFF}
      />
      <g data-k="rise" mask={ref('out')} opacity="0">
        <circle data-k="riseHalo" cx={SX} cy={SY} r="11" fill={ref('ha')} />
        <circle data-k="riseCore" cx={SX} cy={SY} r="3" fill={ref('st')} />
      </g>
      <circle
        data-k="rim"
        cx="50"
        cy="48"
        r="28"
        fill={ref('lg')}
        mask={ref('lm')}
        opacity={initial}
      />
      <g data-k="beads" opacity={initial}>
        <circle cx="68.41" cy="28.25" r="1.98" fill={ref('bd')} fillOpacity="0.55" />
        <circle cx="74.67" cy="37.02" r="1.62" fill={ref('bd')} fillOpacity="0.45" />
      </g>
      <g data-k="sun" opacity={initial}>
        <circle data-k="sunHalo" cx={SX} cy={SY} r="11" fill={ref('ha')} />
        <circle cx={SX} cy={SY} r="2.6" fill={ref('st')} />
        <circle cx={SX} cy={SY} r="1.4" fill="#FFFFFF" />
      </g>
      <circle data-k="flare" cx={SX} cy={SY} r="7" fill={ref('st')} opacity="0" />
    </svg>
  )
}

export default Eclipse
