import { describe, expect, it } from 'vitest'
import { FAKE_IP_RANGE6, addFakeIPv6Range } from '../src/main/noctur/ipv6'

// IPv6 through the tunnel: in fake-ip mode the core answers AAAA queries only from a fake IPv6 range.

describe('addFakeIPv6Range', () => {
  it('gives a fake-ip DNS config a fake IPv6 range, so apps get IPv6 answers through the tunnel', () => {
    // Without the range, the core answers every AAAA query with nothing.
    const profile = { dns: { enable: true, 'enhanced-mode': 'fake-ip' } }
    addFakeIPv6Range(profile)
    expect(profile.dns).toHaveProperty('fake-ip-range6', FAKE_IP_RANGE6)
  })

  it('leaves a profile that turns IPv6 off without IPv6', () => {
    const profile = { ipv6: false, dns: { enable: true, 'enhanced-mode': 'fake-ip' } }
    addFakeIPv6Range(profile)
    expect(profile.dns).not.toHaveProperty('fake-ip-range6')
  })
})
