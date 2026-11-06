// Noctur: a window stays hidden until its page reports a frame drawn with its theme, so it never
// appears blank. A page that never reports one, such as one whose renderer crashed, must not leave
// the user without a window, so the show also has a time limit.

export const SHOW_FALLBACK_MS = 3000

export interface ShowGate {
  /** Shows the window now when it is ready, otherwise when it becomes ready or at the time limit. */
  requestShow: () => void
  /** A frame with the page's theme is ready. Returns true when this call showed the window. */
  markReady: () => boolean
  /** The window is gone: nothing may be shown any more. */
  dispose: () => void
}

export function createShowGate(show: () => void, fallbackMs = SHOW_FALLBACK_MS): ShowGate {
  let ready = false
  let pending = false
  let timer: NodeJS.Timeout | null = null

  const clearTimer = (): void => {
    if (timer) clearTimeout(timer)
    timer = null
  }

  return {
    requestShow: () => {
      if (ready) {
        show()
        return
      }
      pending = true
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        if (!pending) return
        pending = false
        show()
      }, fallbackMs)
    },
    markReady: () => {
      ready = true
      clearTimer()
      if (!pending) return false
      pending = false
      show()
      return true
    },
    dispose: () => {
      clearTimer()
      pending = false
    }
  }
}
