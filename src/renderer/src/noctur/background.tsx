import React, { useEffect, useRef } from 'react'
import {
  ShaderMount,
  getShaderColorFromString,
  meshGradientFragmentShader,
  type ShaderMountUniforms
} from '@paper-design/shaders'
import { findPalette, type PaletteTokens } from './palettes'
import { DEFAULT_FPS, clampFps, dotScale } from './fps'

// Noctur window background: Paper's mesh gradient (@paper-design/shaders 0.0.82) in the skin's colors
// (palettes.ts), smooth or as a fine grid of dots whose size follows its brightness, or the plain
// page color ('flat', shown as Plain). It moves at 24 frames a second (a setting) while the window
// is the active one, and stops when the window is hidden or another app is in front; with Reduce
// motion it draws once. Settings, Appearance shows each skin in a small live preview
// (BackgroundPreview).

export type BackgroundKind = 'gradient' | 'flat'

// The saved settings as a kind and the dots switch. Any saved kind other than 'flat' reads as the
// gradient; the dots are off unless switched on.
export function resolveBackground(
  background: string | undefined,
  dots: boolean | undefined
): { kind: BackgroundKind; dots: boolean } {
  return { kind: background === 'flat' ? 'flat' : 'gradient', dots: !!dots }
}

// The dots edit Paper's source text; a missing line means Paper changed, so fail loudly.
const swap = (source: string, from: string, to: string): string => {
  if (!source.includes(from)) throw new Error(`Paper shader changed: ${from}`)
  return source.replace(from, to)
}
const PRECISION = 'precision mediump float;'
const OUTPUT = 'fragColor = vec4(color, opacity);'

// Dots: the gradient's output replaced by a 3 px dot grid. The dot's size and brightness follow the
// picture's brightness at that point.
const dotted = (fragment: string): string =>
  swap(
    swap(
      fragment,
      PRECISION,
      `${PRECISION}\nuniform float u_pixelRatio;\nuniform vec3 u_bg;\nuniform float u_darkTheme;\nuniform vec2 u_lightRange;`
    ),
    OUTPUT,
    `
  // A whole number of pixels per cell, so the grid lines up with the screen at any scale. The names
  // start with dot_, so they cannot clash with the shader's own.
  float dot_cell = floor(3.0 * u_pixelRatio + 0.5);
  vec2 dot_at = mod(gl_FragCoord.xy, dot_cell) - 0.5 * dot_cell;
  float dot_lum = dot(color, vec3(0.299, 0.587, 0.114));
  float dot_size = u_darkTheme > 0.5 ? smoothstep(0.05, 0.24, dot_lum) : 1.0 - smoothstep(u_lightRange.x, u_lightRange.y, dot_lum);
  float dot_r = mix(0.08, 0.4, dot_size) * dot_cell;
  float dot_a = 1.0 - smoothstep(dot_r - 0.6, dot_r + 0.6, length(dot_at));
  vec3 dot_color = u_darkTheme > 0.5 ? min(color * 1.35 + 0.015, vec3(1.0)) : color * 0.82;
  fragColor = vec4(mix(u_bg, dot_color, dot_a), 1.0);`
  )

// Paper's sizing uniforms for a picture that covers its area.
const SIZING = {
  u_fit: 2,
  u_scale: 0.85,
  u_rotation: 0,
  u_offsetX: 0,
  u_offsetY: 0,
  u_originX: 0.5,
  u_originY: 0.5,
  u_worldWidth: 0,
  u_worldHeight: 0
}
const SPEED = 0.45
const color = (hex: string): number[] => getShaderColorFromString(hex)
// In light the dot size follows the brightness between the skin's darkest and lightest mesh color:
// the pearl's colors are close (about 0.86 to 0.97), and over a fixed 0.8 to 0.96 the dots would be
// nearly all one size, so the movement would barely show.
const brightness = (hex: string): number => {
  const [r, g, b] = color(hex)
  return 0.299 * r + 0.587 * g + 0.114 * b
}
const lightRange = (mesh: string[]): number[] => {
  const values = mesh.map(brightness)
  return [Math.min(...values), Math.max(...values)]
}

interface Spec {
  fragment: string
  uniforms: ShaderMountUniforms
  pixels: number
}

// What to draw, and at most how many pixels: the smooth gradient has no detail to lose, so the window
// draws it at up to 960 x 600 and scales it up; dots at the pixels dotScale gives.
const shaderSpec = (
  kind: BackgroundKind,
  dots: boolean,
  t: PaletteTokens,
  dark: boolean,
  pixels: { smooth: number; dots: number }
): Spec | null => {
  if (kind !== 'gradient') return null
  let spec: Spec
  {
    const colors = t.mesh.map(color)
    spec = {
      fragment: meshGradientFragmentShader,
      uniforms: {
        ...SIZING,
        u_colors: colors,
        u_colorsCount: colors.length,
        u_distortion: 0.8,
        u_swirl: 0.25,
        u_grainMixer: 0,
        u_grainOverlay: 0
      },
      pixels: pixels.smooth
    }
  }
  if (!dots) return spec
  return {
    fragment: dotted(spec.fragment),
    uniforms: {
      ...spec.uniforms,
      u_bg: t.dotBack,
      u_darkTheme: dark ? 1 : 0,
      u_lightRange: lightRange(t.mesh)
    },
    pixels: pixels.dots
  }
}

interface Options {
  kind: BackgroundKind
  dots: boolean
  palette: string
  dark: boolean
  fps: number
  // A preview draws at its own size; the window background at the limits in shaderSpec.
  preview: boolean
  // The animation's time, kept across changes so the picture does not jump back.
  clock: { t: number }
}

// By default Paper draws on every screen refresh, 120 times a second on a ProMotion display, which
// keeps the graphics process busy. The motion is slow, so a timer gives it 24 frames a second, which
// look the same (fps.ts), and only while the window is the active one.
const useShader = (host: React.RefObject<HTMLDivElement | null>, o: Options): void => {
  const { kind, dots, palette, dark, fps, preview, clock } = o
  useEffect(() => {
    const el = host.current
    if (!el || kind === 'flat') return undefined
    const tokens = dark ? findPalette(palette).dark : findPalette(palette).light
    const area = (scale: number): number =>
      Math.ceil(el.clientWidth * scale) * Math.ceil(el.clientHeight * scale)
    const dotCount = (): number => area(dotScale(window.devicePixelRatio || 1))
    const full = area(window.devicePixelRatio || 1)
    const spec = shaderSpec(kind, dots, tokens, dark, {
      smooth: preview ? full : 960 * 600,
      dots: dotCount()
    })
    if (!spec) return undefined
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let mount: ShaderMount | null = null
    try {
      // Speed 0: Paper draws only when given a frame, and the timer below gives it one.
      mount = new ShaderMount(
        el,
        spec.fragment,
        spec.uniforms,
        undefined,
        0,
        clock.t,
        1,
        spec.pixels
      )
    } catch {
      // No WebGL 2: the plain page background stays.
      mount = null
    }
    // Keep the dots' resolution in step with the area's size.
    const fit = (): void => {
      if (dots) mount?.setMaxPixelCount(dotCount())
    }
    window.addEventListener('resize', fit)
    if (!mount || still)
      return (): void => {
        window.removeEventListener('resize', fit)
        mount?.dispose()
      }
    const m = mount
    let timer: ReturnType<typeof setInterval> | undefined
    let last = 0
    const tick = (): void => {
      const now = performance.now()
      clock.t += (now - last) * SPEED
      last = now
      m.setFrame(clock.t)
    }
    const run = (): void => {
      if (timer || document.hidden || !document.hasFocus()) return
      last = performance.now()
      timer = setInterval(tick, 1000 / clampFps(fps))
    }
    const stop = (): void => {
      clearInterval(timer)
      timer = undefined
    }
    const onVisibility = (): void => (document.hidden ? stop() : run())
    window.addEventListener('focus', run)
    window.addEventListener('blur', stop)
    document.addEventListener('visibilitychange', onVisibility)
    run()
    return (): void => {
      stop()
      window.removeEventListener('focus', run)
      window.removeEventListener('blur', stop)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('resize', fit)
      m.dispose()
    }
  }, [host, kind, dots, palette, dark, fps, preview, clock])
}

const windowClock = { t: 0 }

interface Props {
  kind: BackgroundKind
  dots: boolean
  palette: string
  dark: boolean
  fps?: number
}

const Background: React.FC<Props> = ({ kind, dots, palette, dark, fps = DEFAULT_FPS }) => {
  const hostRef = useRef<HTMLDivElement>(null)

  // The window's base color shows in areas exposed during a resize; match it to the skin. The skin's
  // variables are applied after this component's effects run, so this follows their changes.
  useEffect(() => {
    const send = (): void => {
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--p-bg').trim()
      if (/^#[0-9a-f]{6}$/i.test(bg)) window.electron.ipcRenderer.send('nocturWindowBackground', bg)
    }
    send()
    const observer = new MutationObserver(send)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-palette']
    })
    window.addEventListener('noctur:palette', send)
    return (): void => {
      observer.disconnect()
      window.removeEventListener('noctur:palette', send)
    }
  }, [])

  // Cards turn to frosted glass when something moves behind them, with less blur over dots so the
  // dots stay dots (fork-theme.css).
  const look = kind === 'flat' ? 'flat' : dots ? 'dots' : 'gradient'
  useEffect(() => {
    document.documentElement.dataset.bg = look
    return (): void => {
      delete document.documentElement.dataset.bg
    }
  }, [look])

  useShader(hostRef, { kind, dots, palette, dark, fps, preview: false, clock: windowClock })

  return <div ref={hostRef} className="noctur-backdrop" data-kind={kind} aria-hidden="true" />
}

// A small live sample of a skin's background, for Settings, Appearance.
export const BackgroundPreview: React.FC<Props> = ({
  kind,
  dots,
  palette,
  dark,
  fps = DEFAULT_FPS
}) => {
  const hostRef = useRef<HTMLDivElement>(null)
  const clock = useRef({ t: 0 }).current
  useShader(hostRef, { kind, dots, palette, dark, fps, preview: true, clock })
  return <div ref={hostRef} className="noctur-bg-preview-art" aria-hidden="true" />
}

export default Background
