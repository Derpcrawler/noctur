import React, { createContext, useContext, ReactNode, useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { profileErrorToast } from '@renderer/noctur/error-toast'
import useSWR from 'swr'
import {
  getProfileConfig,
  setProfileConfig as set,
  addProfileItem as add,
  removeProfileItem as remove,
  updateProfileItem as update,
  changeCurrentProfile as change
} from '@renderer/utils/ipc'

interface ProfileConfigContextType {
  profileConfig: ProfileConfig | undefined
  setProfileConfig: (config: ProfileConfig) => Promise<void>
  mutateProfileConfig: () => void
  addProfileItem: (item: Partial<ProfileItem>) => Promise<void>
  updateProfileItem: (item: ProfileItem) => Promise<void>
  removeProfileItem: (id: string) => Promise<void>
  changeCurrentProfile: (id: string) => Promise<void>
  hwidLimitError: string | null
  clearHwidLimitError: () => void
}

const ProfileConfigContext = createContext<ProfileConfigContextType | undefined>(undefined)

export const ProfileConfigProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { data: profileConfig, mutate: mutateProfileConfig } = useSWR('getProfileConfig', () =>
    getProfileConfig()
  )
  const [hwidLimitError, setHwidLimitError] = useState<string | null>(null)

  const setHwidLimitErrorFromMessage = useCallback((message: string): void => {
    const match = message.match(/HWID_LIMIT:(.*)/)
    if (match) {
      setHwidLimitError(match[1].trim())
      return
    }
    setHwidLimitError(message.trim())
  }, [])

  const clearHwidLimitError = useCallback(() => setHwidLimitError(null), [])

  const profileItem = (id: string | undefined): ProfileItem | undefined =>
    profileConfig?.items?.find((i) => i.id === id)

  const setProfileConfig = async (config: ProfileConfig): Promise<void> => {
    try {
      await set(config)
    } catch (e) {
      toast.error(`${e}`)
    } finally {
      mutateProfileConfig()
      window.electron.ipcRenderer.send('updateTrayMenu')
    }
  }

  const addProfileItem = async (item: Partial<ProfileItem>): Promise<void> => {
    try {
      await add(item)
    } catch (e) {
      if (`${e}`.includes('HWID_LIMIT')) {
        setHwidLimitErrorFromMessage(`${e}`)
      } else {
        profileErrorToast(e, profileItem(item.id) ?? (item as ProfileItem))
      }
    } finally {
      mutateProfileConfig()
      window.electron.ipcRenderer.send('updateTrayMenu')
    }
  }

  const removeProfileItem = async (id: string): Promise<void> => {
    try {
      await remove(id)
    } catch (e) {
      toast.error(`${e}`)
    } finally {
      mutateProfileConfig()
      window.electron.ipcRenderer.send('updateTrayMenu')
    }
  }

  const updateProfileItem = async (item: ProfileItem): Promise<void> => {
    try {
      await update(item)
    } catch (e) {
      profileErrorToast(e, item)
    } finally {
      mutateProfileConfig()
      window.electron.ipcRenderer.send('updateTrayMenu')
    }
  }

  const changeCurrentProfile = async (id: string): Promise<void> => {
    try {
      await change(id)
    } catch (e) {
      profileErrorToast(e, profileItem(id))
    } finally {
      mutateProfileConfig()
      window.electron.ipcRenderer.send('updateTrayMenu')
    }
  }

  useEffect(() => {
    const handleProfileConfigUpdated = (): void => {
      mutateProfileConfig()
    }
    const handleShowHwidLimitError = (_event: unknown, supportUrl = ''): void => {
      setHwidLimitErrorFromMessage(supportUrl)
    }

    window.electron.ipcRenderer.on('profileConfigUpdated', handleProfileConfigUpdated)
    window.electron.ipcRenderer.on('show-hwid-limit-error', handleShowHwidLimitError)

    return (): void => {
      window.electron.ipcRenderer.removeListener('profileConfigUpdated', handleProfileConfigUpdated)
      window.electron.ipcRenderer.removeListener('show-hwid-limit-error', handleShowHwidLimitError)
    }
  }, [mutateProfileConfig, setHwidLimitErrorFromMessage])

  return (
    <ProfileConfigContext.Provider
      value={{
        profileConfig,
        setProfileConfig,
        mutateProfileConfig,
        addProfileItem,
        removeProfileItem,
        updateProfileItem,
        changeCurrentProfile,
        hwidLimitError,
        clearHwidLimitError
      }}
    >
      {children}
    </ProfileConfigContext.Provider>
  )
}

export const useProfileConfig = (): ProfileConfigContextType => {
  const context = useContext(ProfileConfigContext)
  if (context === undefined) {
    throw new Error('useProfileConfig must be used within a ProfileConfigProvider')
  }
  return context
}
