// Noctur: the moving background's frame rate and the dots' resolution (background.tsx). The frame
// rate is set in Settings, Appearance: 24 by default, 30, 60 or another whole number. A rate outside 1 to 120, or not a number, would make the
// timer fire as fast as it can, so it is clamped.

export const DEFAULT_FPS = 24
export const FPS_PRESETS = [24, 30, 60]
export const MIN_FPS = 1
export const MAX_FPS = 120
export const clampFps = (n: number): number =>
  Number.isFinite(n) ? Math.min(MAX_FPS, Math.max(MIN_FPS, Math.round(n))) : DEFAULT_FPS

// The dots' resolution: on a 2x (Retina) screen, one pixel per point, a quarter of the pixels and
// visually the same, scaled up by exactly 2 so the grid stays even; below 2x the
// screen's own resolution, since a fractional scale-up spaces the dots unevenly. Never below one pixel
// per point: the smallest dots are a quarter of a pixel across there already.
export function dotScale(dpr: number): number {
  return dpr >= 2 ? Math.floor(dpr) / 2 : Math.max(1, dpr)
}
