// Noctur: the route from a proxy group down to the server in use. A group's selection can be another
// group (a Selector set to a fastest-server group, for example), so the route follows the selections
// until it reaches something that is not a group. That group can be hidden (`hidden: true`), and hidden
// groups are not in the list Home gets, so the walk also looks at the entries of every group's member
// list, where a hidden group appears with its own selection. Group setups can point in a circle, so
// the walk stops at the first group it has already seen.

interface Entry {
  name: string
  type: string
  now?: string
  history?: { delay: number }[]
}

interface Step extends Entry {
  // Group members: objects in the list Home gets, names inside a nested group's entry.
  all?: (Entry | string)[]
}

export interface Route {
  // The starting group's own selection: a server, or a group.
  selection: string
  // The server the route ends on, or the last group's selection when it is not listed anywhere.
  server: { name: string; type: string; delay: number }
}

export function lastDelay(p?: { history?: { delay: number }[] }): number {
  const h = p?.history
  return h && h.length ? h[h.length - 1].delay : -1
}

// Every group and member by name. A listed group comes first, as it carries the member objects.
export function indexOf(groups: Step[]): Map<string, Step> {
  const byName = new Map<string, Step>()
  for (const g of groups) byName.set(g.name, g)
  for (const g of groups) {
    for (const p of g.all ?? []) {
      if (typeof p !== 'string' && !byName.has(p.name)) byName.set(p.name, p)
    }
  }
  return byName
}

export function routeOf(groups: Step[], start: Step, index = indexOf(groups)): Route {
  const seen = new Set([start.name])
  let cur: Step = start
  for (;;) {
    const next = cur.now ? index.get(cur.now) : undefined
    // A group has a selection of its own; a server does not.
    if (!next || next.now === undefined || seen.has(next.name)) break
    seen.add(next.name)
    cur = next
  }
  const name = cur.now ?? ''
  const leaf = index.get(name)
  return {
    selection: start.now ?? '',
    server: { name, type: leaf?.type ?? '', delay: lastDelay(leaf) }
  }
}
