import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }))

import { addressRules } from '../src/main/noctur/address'
import { clampFps, dotScale } from '../src/renderer/src/noctur/fps'

// Home's address tiles, and the moving background's frame rate and dot resolution.

describe('addressRules', () => {
  it('sends the proxied lookup through the first select group, not the first group', () => {
    // The profile lists its fastest-server group before the select group.
    const rules = addressRules([
      { name: 'Auto', type: 'url-test' },
      { name: 'Proxy', type: 'select' }
    ])
    expect(rules).toContain('DOMAIN,api-ipv4.ip.sb,Proxy')
    expect(rules).toContain('DOMAIN,ipwho.is,DIRECT')
  })

  it('writes no rule for a group whose name has a comma, which mihomo would refuse at start', () => {
    const rules = addressRules([{ name: 'Fast, cheap', type: 'select' }])
    expect(rules.every((r) => r.split(',').length === 3)).toBe(true)
  })
})

describe('clampFps', () => {
  it('keeps a custom rate the timer can use', () => {
    // 0 or text in the custom field would make setInterval fire as fast as it can.
    expect(clampFps(0)).toBe(1)
    expect(clampFps(Number.NaN)).toBe(24)
    expect(clampFps(500)).toBe(120)
    expect(clampFps(29.6)).toBe(30)
  })
})

describe('dotScale', () => {
  it('never draws the dots below one pixel per point, and halves only on 2x screens', () => {
    // Below one pixel per point the smallest dots vanish; a fractional scale-up spaces them unevenly.
    expect(dotScale(1)).toBe(1)
    expect(dotScale(1.25)).toBe(1.25)
    expect(dotScale(2)).toBe(1)
    expect(dotScale(3)).toBe(1.5)
  })
})

describe('refreshAddress', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps the last address when a later lookup fails', async () => {
    let direct = 0
    const invoke = vi.fn(async (_ch: string, kind: string) => {
      if (kind !== 'direct') throw new Error('no IPv6')
      direct += 1
      if (direct > 1) throw new Error('offline')
      return { ip: '203.0.113.24' }
    })
    vi.stubGlobal('window', { electron: { ipcRenderer: { invoke } } })
    const { refreshAddress, useAddresses } = await import('../src/renderer/src/noctur/addresses')
    await refreshAddress('direct')
    await refreshAddress('direct', '', true)
    expect(useAddresses.getState().direct?.info.ip).toBe('203.0.113.24')
    expect(useAddresses.getState().failed.direct).toBe(true)
  })

  it('shows the IPv4 address on a network without IPv6, without calling the lookup failed', async () => {
    vi.resetModules()
    const invoke = vi.fn(async (_ch: string, kind: string) => {
      if (kind === 'direct6') throw new Error('no route to host')
      return { ip: '198.51.100.20' }
    })
    vi.stubGlobal('window', { electron: { ipcRenderer: { invoke } } })
    const { refreshAddress, useAddresses } = await import('../src/renderer/src/noctur/addresses')
    await refreshAddress('direct', '', true)
    expect(useAddresses.getState().direct?.info).toEqual({ ip: '198.51.100.20', ipv6: undefined })
    expect(useAddresses.getState().failed.direct).toBe(false)
  })

  it('asks for a missing IPv6 line again at the next check, not only after ten minutes', async () => {
    // The first IPv6 try fails while the route comes up.
    vi.resetModules()
    let v6 = 0
    const invoke = vi.fn(async (_ch: string, kind: string) => {
      if (kind === 'proxied6') {
        v6 += 1
        if (v6 === 1) throw new Error('route not ready')
        return '2001:db8::7'
      }
      return { ip: '198.51.100.7' }
    })
    vi.stubGlobal('window', { electron: { ipcRenderer: { invoke } } })
    const { refreshAddress, useAddresses } = await import('../src/renderer/src/noctur/addresses')
    await refreshAddress('proxied', 'Amsterdam')
    expect(useAddresses.getState().proxied.Amsterdam?.info.ipv6).toBeUndefined()
    await refreshAddress('proxied', 'Amsterdam')
    expect(useAddresses.getState().proxied.Amsterdam?.info.ipv6).toBe('2001:db8::7')
  })
})
