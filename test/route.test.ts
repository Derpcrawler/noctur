import { describe, expect, it } from 'vitest'
import { routeOf } from '../src/renderer/src/noctur/route'

// Home's route line: from the main group down to the server in use.

const node = (name: string, type: string, delay: number) => ({ name, type, history: [{ delay }] })
const group = (
  name: string,
  type: string,
  now: string,
  all: (ReturnType<typeof node> | ReturnType<typeof nested>)[]
) => ({
  name,
  type,
  now,
  all
})
// A group as it appears inside another group's member list: its members are names only.
const nested = (name: string, type: string, now: string, all: string[]) => ({
  name,
  type,
  now,
  all,
  history: []
})

describe('routeOf', () => {
  it('follows a group that selects another group down to that group’s server', () => {
    const auto = group('Auto', 'URLTest', 'Amsterdam', [
      node('Amsterdam', 'Hysteria2', 35),
      node('Frankfurt', 'Vless', 41)
    ])
    const proxy = group('Proxy', 'Selector', 'Auto', [
      nested('Auto', 'URLTest', 'Amsterdam', ['Amsterdam']),
      node('Frankfurt', 'Vless', 41)
    ])
    const r = routeOf([proxy, auto], proxy)
    expect(r.selection).toBe('Auto')
    expect(r.server).toEqual({ name: 'Amsterdam', type: 'Hysteria2', delay: 35 })
  })

  it('follows a hidden group, which is not in the list, to its server', () => {
    // Hidden groups are left out of the list Home gets.
    const proxy = group('Proxy', 'Selector', 'Fastest', [
      nested('Fastest', 'URLTest', 'Amsterdam', ['Amsterdam', 'Frankfurt']),
      node('Amsterdam', 'Vless', 54),
      node('Frankfurt', 'Vless', 61)
    ])
    const r = routeOf([proxy], proxy)
    expect(r.server).toEqual({ name: 'Amsterdam', type: 'Vless', delay: 54 })
    expect(r.selection).toBe('Fastest')
  })

  it('stops when groups select each other in a circle', () => {
    const a = group('A', 'Selector', 'B', [node('B', 'Selector', -1)])
    const b = group('B', 'Selector', 'A', [node('A', 'Selector', -1)])
    expect(routeOf([a, b], a).server.name).toBe('A')
  })
})
