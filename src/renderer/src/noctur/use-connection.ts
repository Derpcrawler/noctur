import { create } from 'zustand'
import { toast } from 'sonner'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useControledMihomoConfig } from '@renderer/hooks/use-controled-mihomo-config'
import { changeConnectionMethod, setConnected, updateTrayIcon } from '@renderer/utils/ipc'

// Noctur: connecting, disconnecting and changing the method, shared by Home and the sidebar so both
// show the same busy state while a change is under way.

interface BusyState {
  busy: null | 'connecting' | 'disconnecting'
  set: (busy: BusyState['busy']) => void
}
const useBusy = create<BusyState>((set) => ({ busy: null, set: (busy) => set({ busy }) }))

export interface Connection {
  connected: boolean
  busy: BusyState['busy']
  method: 'tun' | 'sysproxy'
  // Connect is not possible: System Proxy with a manual proxy needs the mixed port.
  disabled: boolean
  // System Proxy cannot carry traffic while connected (manual proxy without a mixed port).
  proxyUnusable: boolean
  toggle: () => Promise<void>
  changeMethod: (to: string) => Promise<void>
}

export function useConnection(): Connection {
  const { appConfig } = useAppConfig()
  const { mainSwitchMode = 'tun', sysProxy, proxyMode = false } = appConfig || {}
  const { enable: writeSysProxy = true, mode } = sysProxy || {}
  const { controledMihomoConfig } = useControledMihomoConfig()
  const { tun, 'mixed-port': mixedPort } = controledMihomoConfig || {}
  const { busy, set } = useBusy()
  const connected = (tun?.enable ?? false) || proxyMode
  const proxyUnusable = writeSysProxy && mode == 'manual' && mixedPort == 0
  const disabled = busy !== null || (mainSwitchMode === 'sysproxy' && proxyUnusable)

  const toggle = async (): Promise<void> => {
    if (disabled) return
    const enable = !connected
    set(enable ? 'connecting' : 'disconnecting')
    try {
      await setConnected(enable)
      window.electron.ipcRenderer.send('updateFloatingWindow')
      window.electron.ipcRenderer.send('updateTrayMenu')
      await updateTrayIcon()
    } catch (e) {
      toast.error(`${e}`)
    } finally {
      set(null)
    }
  }

  // A change while connected reconnects through the new method.
  const changeMethod = async (to: string): Promise<void> => {
    if (busy || to === mainSwitchMode || (to !== 'tun' && to !== 'sysproxy')) return
    if (connected) set('connecting')
    try {
      await changeConnectionMethod(to as 'tun' | 'sysproxy')
      await updateTrayIcon()
    } catch (e) {
      toast.error(`${e}`)
    } finally {
      set(null)
    }
  }

  return { connected, busy, method: mainSwitchMode === 'sysproxy' ? 'sysproxy' : 'tun', disabled, proxyUnusable, toggle, changeMethod }
}
