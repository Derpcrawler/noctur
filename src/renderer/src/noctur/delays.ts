import { create } from 'zustand'
import { subscribeCoreStarted } from '@renderer/store/core-lifecycle-store'

// Noctur: the last delay of each server on Home. It is filled from the core's delay history
// and from Test all results, so a row keeps its number when a later groups refresh has no history for
// that server. A new core run starts empty.

interface DelayMemory {
  delays: Record<string, number>
  merge: (found: Record<string, number>) => void
}

export const useDelayMemory = create<DelayMemory>((set) => ({
  delays: {},
  merge: (found) =>
    set((s) => {
      const changed = Object.keys(found).some((k) => s.delays[k] !== found[k])
      return changed ? { delays: { ...s.delays, ...found } } : s
    })
}))

// Home tests every group once per core run, the first time it shows them while connected, so
// delays show without running Test all. A new core run starts over.
export const autoTest = { done: false }

subscribeCoreStarted(() => {
  useDelayMemory.setState({ delays: {} })
  autoTest.done = false
})

// The core's number when it has one, otherwise the remembered one; -1 when there is neither.
export function delayFor(name: string, fromCore: number, memory: Record<string, number>): number {
  return fromCore >= 0 ? fromCore : (memory[name] ?? -1)
}
