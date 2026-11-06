import React, { useState } from 'react'
import { toast } from 'sonner'
import SettingCard from '../base/base-setting-card'
import SettingItem from '../base/base-setting-item'
import { Button } from '@renderer/components/ui/button'
import { Switch } from '@renderer/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import useSWR from 'swr'
import { checkAutoRun, disableAutoRun, enableAutoRun, relaunchApp } from '@renderer/utils/ipc'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import ConfirmModal from '../base/base-confirm'
import { useTranslation } from 'react-i18next'
import { FORK } from '@renderer/fork'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText
} from '@renderer/components/ui/input-group'
import { Tabs, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import { MessageCircleQuestionMark } from 'lucide-react'

interface GeneralConfigProps {
  showHiddenSettings: boolean
}

const GeneralConfig: React.FC<GeneralConfigProps> = (props) => {
  const { showHiddenSettings } = props
  const { t } = useTranslation()
  const { data: enable, mutate: mutateEnable } = useSWR('checkAutoRun', checkAutoRun)
  const { appConfig, patchAppConfig } = useAppConfig()
  const {
    silentStart = false,

    disableGPU = false,
    checkUpdates,
    autoLightweight = true,
    autoLightweightDelay = 300,
    autoLightweightMode = 'core',
  } = appConfig || {}

  const [showRestartConfirm, setShowRestartConfirm] = useState(false)
  const [pendingDisableGPU, setPendingDisableGPU] = useState(disableGPU)

  return (
    <>
      {showRestartConfirm && (
        <ConfirmModal
          title={t('modal.confirmRestart')}
          description={
            <div>
              <p>{t('modal.restartForGPUChange')}</p>
            </div>
          }
          confirmText={t('common.restart')}
          cancelText={t('common.cancel')}
          onChange={(open) => {
            if (!open) {
              setPendingDisableGPU(disableGPU)
            }
            setShowRestartConfirm(open)
          }}
          onConfirm={async () => {
            await patchAppConfig({ disableGPU: pendingDisableGPU })
            await relaunchApp()
          }}
        />
      )}
      <SettingCard>
        <SettingItem title={t('settings.advanced.autoEnterLightMode')} divider>
          <Switch
            checked={autoLightweight}
            onCheckedChange={(value) => {
              patchAppConfig({ autoLightweight: value })
            }}
          />
        </SettingItem>
        <div className="noctur-row-note">{t('settings.advanced.autoEnterLightModeHelp')}</div>
        {autoLightweight && (
          <>
            {FORK.keepCore && (
            <SettingItem title={t('settings.advanced.lightModeBehavior')} divider>
              <Tabs
                value={autoLightweightMode}
                onValueChange={(value) => {
                  patchAppConfig({ autoLightweightMode: value as 'core' | 'tray' })
                  if (value === 'core') {
                    patchAppConfig({ autoLightweightDelay: Math.max(autoLightweightDelay, 5) })
                  }
                }}
              >
                <TabsList>
                  <TabsTrigger value="core">{t('settings.advanced.keepCoreOnly')}</TabsTrigger>
                  <TabsTrigger value="tray">{t('settings.advanced.closeRendererOnly')}</TabsTrigger>
                </TabsList>
              </Tabs>
            </SettingItem>
            )}
            <SettingItem title={t('settings.advanced.autoEnterLightModeDelay')} divider>
              <InputGroup className="w-37.5 h-8">
                <InputGroupInput
                  type="number"
                  value={autoLightweightDelay.toString()}
                  onChange={async (event) => {
                    let num = parseInt(event.target.value)
                    if (isNaN(num)) num = 0
                    const minDelay = autoLightweightMode === 'core' && FORK.keepCore ? 5 : 0
                    if (num < minDelay) num = minDelay
                    await patchAppConfig({ autoLightweightDelay: num })
                  }}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>{t('settings.advanced.seconds')}</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
            </SettingItem>
          </>
        )}
        <SettingItem title={t('settings.general.autoStart')} divider>
          <Switch
            checked={enable}
            onCheckedChange={async (value) => {
              try {
                if (value) {
                  await enableAutoRun()
                } else {
                  await disableAutoRun()
                }
              } catch (e) {
                toast.error(`${e}`)
              } finally {
                mutateEnable()
              }
            }}
          />
        </SettingItem>
        <SettingItem title={t('settings.general.silentStart')} divider>
          <Switch
            checked={silentStart}
            onCheckedChange={(value) => {
              patchAppConfig({ silentStart: value })
            }}
          />
        </SettingItem>
        {/* Noctur: on unless turned off (checkUpdates unset counts as on; Astra Clash's
            autoCheckUpdate was saved as false without ever being shown). */}
        <SettingItem title={t('noctur.update.settingCheck')} divider={showHiddenSettings}>
          <Switch
            checked={checkUpdates !== false}
            onCheckedChange={(value) => {
              patchAppConfig({ checkUpdates: value })
            }}
          />
        </SettingItem>
        {showHiddenSettings && (
          <SettingItem
            title={t('settings.general.disableGPU')}
            actions={
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon-sm" variant="ghost">
                    <MessageCircleQuestionMark className="text-lg" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('settings.general.disableGPUHelp')}</TooltipContent>
              </Tooltip>
            }
          >
            <Switch
              checked={pendingDisableGPU}
              onCheckedChange={(value) => {
                setPendingDisableGPU(value)
                setShowRestartConfirm(true)
              }}
            />
          </SettingItem>
        )}
      </SettingCard>
    </>
  )
}

export default GeneralConfig
