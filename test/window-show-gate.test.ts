// A window opened from the tray after lightweight mode must not appear before its first frame (it
// shows blank white), and must still appear when the page never reports that frame.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createShowGate } from '../src/main/noctur/window-show'

describe('window show gate', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps a requested window hidden until its first frame is ready', () => {
    const show = vi.fn()
    const gate = createShowGate(show, 3000)
    gate.requestShow()
    expect(show).not.toHaveBeenCalled()
    expect(gate.markReady()).toBe(true)
    expect(show).toHaveBeenCalledTimes(1)
  })

  it('shows the window at the time limit when the page never gets ready', () => {
    const show = vi.fn()
    const gate = createShowGate(show, 3000)
    gate.requestShow()
    vi.advanceTimersByTime(3000)
    expect(show).toHaveBeenCalledTimes(1)
  })
})
