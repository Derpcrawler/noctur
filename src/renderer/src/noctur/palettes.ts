// Noctur skins: Noctur (graphite with a moonlight blue accent, a pearl background in light and a grey-blue one in dark) and Void
// (the same graphite with a grayscale accent and background), each with a dark and a light version.
// A saved id that is not listed here (an earlier palette) falls back to Noctur.
// The values are applied as --p-* variables; fork-theme.css maps them onto the app's own tokens.

export interface PaletteTokens {
  bg: string
  surface: string
  raised: string
  fg: string
  fg2: string
  fg3: string
  accent: string
  strong: string
  on: string
  text: string
  // Colors of the moving background (noctur/background.tsx), darkest first in dark.
  mesh: string[]
  // The dots' gaps, as 0 to 1 RGB.
  dotBack: [number, number, number]
}

export interface Palette {
  id: string
  name: string
  dark: PaletteTokens
  light: PaletteTokens
}

export const DEFAULT_PALETTE = 'noctur'

const GRAPHITE_DARK = {
  bg: '#141415',
  surface: '#19191b',
  raised: '#232325',
  fg: '#ededed',
  fg2: '#a1a1a6',
  fg3: '#85858b'
}
const GRAPHITE_LIGHT = {
  bg: '#fafafa',
  surface: '#ffffff',
  raised: '#f4f4f5',
  fg: '#171717',
  fg2: '#525252',
  fg3: '#737373'
}

export const PALETTES: Palette[] = [
  {
    id: 'noctur',
    name: 'Noctur',
    dark: {
      ...GRAPHITE_DARK,
      accent: '#8fa8ff',
      strong: '#8fa8ff',
      on: '#0b1230',
      text: '#ededed',
      // Near black, dark grey-blue and one pale grey highlight, in the colors of Paper's Warp shader.
      mesh: ['#0b0b0e', '#121318', '#1a1f2c', '#3a3f52', '#101115', '#0b0b0e'],
      dotBack: [0.055, 0.06, 0.08]
    },
    light: {
      ...GRAPHITE_LIGHT,
      accent: '#3f5bb8',
      strong: '#3f5bb8',
      on: '#ffffff',
      text: '#171717',
      mesh: ['#eef1f8', '#d3dcf4', '#ded8f4', '#f4f6fb', '#d9e2f6', '#e8ebf5'],
      dotBack: [0.965, 0.97, 0.98]
    }
  },
  {
    id: 'void',
    name: 'Void',
    dark: {
      ...GRAPHITE_DARK,
      accent: '#e5e5e5',
      strong: '#e5e5e5',
      on: '#141415',
      text: '#ededed',
      mesh: ['#0e0e0f', '#2a2a2c', '#3b3b3d', '#161617', '#313133', '#0b0b0c'],
      dotBack: [0.05, 0.05, 0.05]
    },
    light: {
      ...GRAPHITE_LIGHT,
      accent: '#262626',
      strong: '#262626',
      on: '#ffffff',
      text: '#171717',
      mesh: ['#f2f2f3', '#d8d8da', '#e4e4e6', '#fafafa', '#dddddf', '#ececed'],
      dotBack: [0.97, 0.97, 0.97]
    }
  }
]

export function findPalette(id: string | undefined): Palette {
  return PALETTES.find((p) => p.id === id) ?? PALETTES.find((p) => p.id === DEFAULT_PALETTE)!
}

// The --p-* variables of one palette version, as name and value pairs.
export function paletteVars(t: PaletteTokens, dark: boolean): [string, string][] {
  return [
    ['--p-bg', t.bg],
    ['--p-surface', t.surface],
    ['--p-raised', t.raised],
    ['--p-fg', t.fg],
    ['--p-fg2', t.fg2],
    ['--p-fg3', t.fg3],
    ['--p-accent', t.accent],
    ['--p-strong', t.strong],
    ['--p-accent2', t.strong],
    ['--p-on', t.on],
    ['--p-text', t.text],
    ['--p-line', dark ? 'rgba(237,237,237,.08)' : 'rgba(23,23,23,.08)'],
    ['--p-line-strong', dark ? 'rgba(237,237,237,.14)' : 'rgba(23,23,23,.14)']
  ]
}

function vars(t: PaletteTokens, dark: boolean): string {
  return paletteVars(t, dark)
    .map(([k, v]) => `${k}:${v}`)
    .join(';')
}

// CSS for one palette. The app's .dark class picks the dark version.
export function paletteCss(p: Palette): string {
  return `:root[data-palette]{${vars(p.light, false)}}:root.dark[data-palette]{${vars(p.dark, true)}}`
}

// Applies a palette, or removes it so an imported custom theme shows as its author made it.
export function applyPalette(id: string | null): void {
  const root = document.documentElement
  let style = document.getElementById('noctur-palette') as HTMLStyleElement | null
  if (!id) {
    delete root.dataset.palette
    style?.remove()
    window.dispatchEvent(new Event('noctur:palette'))
    return
  }
  const p = findPalette(id)
  if (!style) {
    style = document.createElement('style')
    style.id = 'noctur-palette'
    document.head.appendChild(style)
  }
  style.textContent = paletteCss(p)
  root.dataset.palette = p.id
  window.dispatchEvent(new Event('noctur:palette'))
}
