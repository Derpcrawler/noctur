// On Windows a shutdown is reported only to windows. With the main window destroyed by lightweight
// mode, the system proxy would stay set after the session ends unless another window reports it.
import { EventEmitter } from 'events'
import { afterEach, describe, expect, it, vi } from 'vitest'

const s = vi.hoisted(() => ({ windows: [] as EventEmitter[] }))

vi.mock('electron', () => ({
  BrowserWindow: class extends EventEmitter {
    constructor() {
      super()
      s.windows.push(this)
    }
  }
}))

import { watchSessionEnd } from '../src/main/noctur/session-end'

describe('session end on Windows', () => {
  const platform = process.platform
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: platform })
  })

  it('runs the cleanup with no main window', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    const cleanup = vi.fn(async () => {})
    watchSessionEnd(cleanup)
    s.windows[0].emit('session-end')
    expect(cleanup).toHaveBeenCalledTimes(1)
  })
})
