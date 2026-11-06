import { DEFAULT_PALETTE, PALETTES, findPalette } from '@renderer/noctur/palettes'
import React, { useEffect, useState, useRef } from 'react'
import { toast } from 'sonner'
import SettingCard from '../base/base-setting-card'
import SettingItem from '../base/base-setting-item'
import { Button } from '@renderer/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Spinner } from '@renderer/components/ui/spinner'
import { Switch } from '@renderer/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText
} from '@renderer/components/ui/input-group'
import { DEFAULT_FPS, FPS_PRESETS, MAX_FPS, MIN_FPS, clampFps } from '@renderer/noctur/fps'
import { BackgroundPreview, resolveBackground } from '@renderer/noctur/background'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import {
  applyTheme,
  closeFloatingWindow,
  closeTrayIcon,
  fetchThemes,
  getFilePath,
  importThemes,
  isAlwaysOnTop,
  relaunchApp,
  resolveThemes,
  setAlwaysOnTop,
  setDockVisible,
  showFloatingWindow,
  showTrayIcon,
  writeTheme
} from '@renderer/utils/ipc'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { platform } from '@renderer/utils/init'
import { useTheme } from 'next-themes'
import CSSEditorModal from './css-editor-modal'
import { useTranslation } from 'react-i18next'
import { CloudDownload, FilePenLine, Import, MessageCircleQuestionMark } from 'lucide-react'

interface AppearanceConfigProps {
  showHiddenSettings: boolean
}

const AppearanceConfig: React.FC<AppearanceConfigProps> = (props) => {
  const { showHiddenSettings } = props
  const { t } = useTranslation()
  const { appConfig, patchAppConfig } = useAppConfig()
  const [customThemes, setCustomThemes] = useState<{ key: string; label: string }[]>()
  const [openCSSEditor, setOpenCSSEditor] = useState(false)
  const [fetching, setFetching] = useState(false)
  const { setTheme, resolvedTheme } = useTheme()
  const {
    useDockIcon = true,
    proxyInTray = true,
    disableTray = false,
    showFloatingWindow: showFloating = false,
    spinFloatingIcon = true,
    useWindowFrame = platform === 'linux',
    customTheme = 'default.css',
    palette = DEFAULT_PALETTE,
    background,
    backgroundDots,
    navIcons = true,
    backgroundFps = DEFAULT_FPS,
    homeGroups = 'tiles',
    homeLayout = 'full',
    homeTraffic = true,
    addressLookup,
    appTheme = 'system'
  } = appConfig || {}
  const bg = resolveBackground(background, backgroundDots)
  const [localShowFloating, setLocalShowFloating] = useState(showFloating)
  // Custom frame rate: chosen, or a saved rate that is not one of the presets.
  const [customFps, setCustomFps] = useState(!FPS_PRESETS.includes(backgroundFps))
  const [fpsText, setFpsText] = useState(String(backgroundFps))
  const commitFps = (): void => {
    const n = clampFps(parseInt(fpsText, 10))
    setFpsText(String(n))
    if (n !== backgroundFps) patchAppConfig({ backgroundFps: n })
  }
  const [onTop, setOnTop] = useState(false)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    setLocalShowFloating(showFloating)
  }, [showFloating])

  useEffect(() => {
    resolveThemes().then((themes) => {
      setCustomThemes(themes)
    })
    isAlwaysOnTop().then(setOnTop)
  }, [])

  useEffect(() => {
    return (): void => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  return (
    <>
      {openCSSEditor && (
        <CSSEditorModal
          theme={customTheme}
          onCancel={() => setOpenCSSEditor(false)}
          onConfirm={async (css: string) => {
            await writeTheme(customTheme, css)
            await applyTheme(customTheme)
            setOpenCSSEditor(false)
          }}
        />
      )}
      <SettingCard title={t('noctur.settings.appearance')}>
        <SettingItem title={t('settings.appearance.backgroundColor')} divider>
          <Tabs
            value={appTheme}
            onValueChange={(value) => {
              setTheme(value)
              patchAppConfig({ appTheme: value as AppTheme })
            }}
          >
            <TabsList>
              <TabsTrigger value="system">{t('settings.appearance.auto')}</TabsTrigger>
              <TabsTrigger value="dark">{t('settings.appearance.dark')}</TabsTrigger>
              <TabsTrigger value="light">{t('settings.appearance.light')}</TabsTrigger>
            </TabsList>
          </Tabs>
        </SettingItem>
        {customTheme === 'default.css' && (
          <>
            <SettingItem title={t('noctur.appearance.skin')} divider>
              {/* Each skin with its own moving background, and Plain: the page color of the skin
                  last chosen, nothing moving. The dots switch carries over. */}
              <div className="noctur-bg-choices" role="radiogroup">
                {PALETTES.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={bg.kind !== 'flat' && findPalette(palette).id === p.id}
                    className="noctur-bg-choice"
                    onClick={() =>
                      patchAppConfig({
                        palette: p.id,
                        background: 'gradient',
                        backgroundDots: bg.dots
                      })
                    }
                  >
                    <span className="noctur-bg-preview">
                      <BackgroundPreview
                        kind="gradient"
                        dots={bg.dots}
                        palette={p.id}
                        dark={resolvedTheme !== 'light'}
                        fps={backgroundFps}
                      />
                    </span>
                    <span className="noctur-bg-name">{p.name}</span>
                  </button>
                ))}
                <button
                  type="button"
                  role="radio"
                  aria-checked={bg.kind === 'flat'}
                  className="noctur-bg-choice"
                  onClick={() => patchAppConfig({ background: 'flat', backgroundDots: bg.dots })}
                >
                  <span className="noctur-bg-preview">
                    <span className="noctur-bg-preview-art" />
                  </span>
                  <span className="noctur-bg-name">{t('noctur.appearance.flat')}</span>
                </button>
              </div>
            </SettingItem>
            {bg.kind !== 'flat' && (
              <SettingItem title={t('noctur.appearance.dots')} divider>
                <Switch
                  checked={bg.dots}
                  onCheckedChange={(v) =>
                    patchAppConfig({ background: bg.kind, backgroundDots: v })
                  }
                />
              </SettingItem>
            )}
            {bg.kind !== 'flat' && (
              <SettingItem title={t('noctur.appearance.fps')} divider>
                <div className="flex items-center gap-2">
                  {customFps && (
                    <InputGroup className="w-24 h-8">
                      <InputGroupInput
                        type="number"
                        min={MIN_FPS}
                        max={MAX_FPS}
                        value={fpsText}
                        aria-label={t('noctur.appearance.fps')}
                        onChange={(e) => setFpsText(e.target.value)}
                        onBlur={commitFps}
                        onKeyDown={(e) => e.key === 'Enter' && commitFps()}
                      />
                      <InputGroupAddon align="inline-end">
                        <InputGroupText>{t('noctur.appearance.fpsUnit')}</InputGroupText>
                      </InputGroupAddon>
                    </InputGroup>
                  )}
                  <Tabs
                    value={customFps ? 'custom' : String(backgroundFps)}
                    onValueChange={(v) => {
                      if (v === 'custom') {
                        setCustomFps(true)
                        return
                      }
                      setCustomFps(false)
                      setFpsText(v)
                      patchAppConfig({ backgroundFps: Number(v) })
                    }}
                  >
                    <TabsList>
                      {FPS_PRESETS.map((n) => (
                        <TabsTrigger key={n} value={String(n)}>
                          {n}
                        </TabsTrigger>
                      ))}
                      <TabsTrigger value="custom">{t('noctur.appearance.custom')}</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
              </SettingItem>
            )}
          </>
        )}
        <SettingItem title={t('noctur.appearance.homeLayout')} divider>
          <Tabs
            value={homeLayout}
            onValueChange={(v) => patchAppConfig({ homeLayout: v as 'full' | 'minimal' })}
          >
            <TabsList>
              <TabsTrigger value="full">{t('noctur.appearance.full')}</TabsTrigger>
              <TabsTrigger value="minimal">{t('noctur.appearance.minimal')}</TabsTrigger>
            </TabsList>
          </Tabs>
        </SettingItem>
        {homeLayout === 'full' && (
          <SettingItem title={t('noctur.appearance.homeGroups')} divider>
            <Tabs
              value={homeGroups}
              onValueChange={(v) => patchAppConfig({ homeGroups: v as 'list' | 'tiles' })}
            >
              <TabsList>
                <TabsTrigger value="list">{t('noctur.appearance.list')}</TabsTrigger>
                <TabsTrigger value="tiles">{t('noctur.appearance.tiles')}</TabsTrigger>
              </TabsList>
            </Tabs>
          </SettingItem>
        )}
        <SettingItem
          title={t('noctur.appearance.addresses')}
          actions={
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t('noctur.appearance.addressesHelp')}
                >
                  <MessageCircleQuestionMark className="text-lg" />
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                {t('noctur.appearance.addressesHelp')}
              </TooltipContent>
            </Tooltip>
          }
          divider
        >
          <Switch
            checked={addressLookup === true}
            onCheckedChange={(v) => patchAppConfig({ addressLookup: v })}
          />
        </SettingItem>
        <SettingItem title={t('noctur.appearance.traffic')} divider>
          <Switch
            checked={homeTraffic}
            onCheckedChange={(v) => patchAppConfig({ homeTraffic: v })}
          />
        </SettingItem>
        <SettingItem title={t('noctur.appearance.navIcons')} divider>
          <Switch checked={navIcons} onCheckedChange={(v) => patchAppConfig({ navIcons: v })} />
        </SettingItem>
        <SettingItem
          title={t('settings.appearance.showFloatingWindow')}
          actions={
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon-sm" variant="ghost">
                  <MessageCircleQuestionMark className="text-lg" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('settings.appearance.showFloatingWindowHelp')}</TooltipContent>
            </Tooltip>
          }
          divider
        >
          <Switch
            checked={localShowFloating}
            onCheckedChange={async (value) => {
              if (timeoutRef.current) {
                clearTimeout(timeoutRef.current)
                timeoutRef.current = null
              }

              setLocalShowFloating(value)
              if (value) {
                await showFloatingWindow()
                timeoutRef.current = setTimeout(async () => {
                  await patchAppConfig({ showFloatingWindow: value })
                  timeoutRef.current = null
                }, 1000)
              } else {
                patchAppConfig({ showFloatingWindow: value })
                await closeFloatingWindow()
              }
            }}
          />
        </SettingItem>
        {localShowFloating && (
          <SettingItem title={t('settings.appearance.rotateFloatingIcon')} divider>
            <Switch
              checked={spinFloatingIcon}
              onCheckedChange={async (value) => {
                await patchAppConfig({ spinFloatingIcon: value })
                window.electron.ipcRenderer.send('updateFloatingWindow')
              }}
            />
          </SettingItem>
        )}
        <SettingItem title={t('settings.appearance.disableTrayIcon')} divider>
          <Switch
            checked={disableTray}
            onCheckedChange={async (value) => {
              await patchAppConfig({ disableTray: value })
              if (value) {
                closeTrayIcon()
              } else {
                showTrayIcon()
              }
            }}
          />
        </SettingItem>
        {platform !== 'linux' && (
          <>
            <SettingItem title={t('settings.appearance.trayShowNodeInfo')} divider>
              <Switch
                checked={proxyInTray}
                onCheckedChange={async (value) => {
                  await patchAppConfig({ proxyInTray: value })
                }}
              />
            </SettingItem>
          </>
        )}
        {platform === 'darwin' && (
          <>
            <SettingItem title={t('settings.appearance.showDockIcon')} divider>
              <Switch
                checked={useDockIcon}
                onCheckedChange={async (value) => {
                  await patchAppConfig({ useDockIcon: value })
                  setDockVisible(value)
                }}
              />
            </SettingItem>
          </>
        )}
        <SettingItem title={t('settings.appearance.alwaysOnTop')} divider>
          <Switch
            checked={onTop}
            onCheckedChange={async (value) => {
              await setAlwaysOnTop(value)
              setOnTop(await isAlwaysOnTop())
            }}
          />
        </SettingItem>
        <SettingItem title={t('settings.appearance.useSystemTitleBar')} divider>
          <Switch
            checked={useWindowFrame}
            onCheckedChange={async (value) => {
              await patchAppConfig({ useWindowFrame: value })
              await relaunchApp()
            }}
          />
        </SettingItem>
        {showHiddenSettings && (
          <SettingItem
            title={t('settings.appearance.theme')}
            actions={
              <>
                <Button
                  size="icon-sm"
                  title={t('settings.appearance.pullTheme')}
                  variant="ghost"
                  disabled={fetching}
                  onClick={async () => {
                    setFetching(true)
                    try {
                      await fetchThemes()
                      setCustomThemes(await resolveThemes())
                    } catch (e) {
                      toast.error(`${e}`)
                    } finally {
                      setFetching(false)
                    }
                  }}
                >
                  {fetching ? (
                    <Spinner className="text-lg" />
                  ) : (
                    <CloudDownload className="text-lg" />
                  )}
                </Button>
                <Button
                  size="icon-sm"
                  title={t('settings.appearance.importTheme')}
                  variant="ghost"
                  onClick={async () => {
                    const files = await getFilePath(['css'])
                    if (!files) return
                    try {
                      await importThemes(files)
                      setCustomThemes(await resolveThemes())
                    } catch (e) {
                      toast.error(`${e}`)
                    }
                  }}
                >
                  <Import className="text-lg" />
                </Button>
                <Button
                  size="icon-sm"
                  title={t('settings.appearance.editTheme')}
                  variant="ghost"
                  onClick={async () => {
                    setOpenCSSEditor(true)
                  }}
                >
                  <FilePenLine className="text-lg" />
                </Button>
              </>
            }
          >
            {customThemes && (
              <Select
                value={customTheme}
                onValueChange={async (value) => {
                  try {
                    await patchAppConfig({ customTheme: value })
                  } catch (e) {
                    toast.error(`${e}`)
                  }
                }}
              >
                <SelectTrigger size="sm" className="w-[60%]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {customThemes.map((theme) => (
                    <SelectItem key={theme.key} value={theme.key}>
                      {theme.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </SettingItem>
        )}
      </SettingCard>
    </>
  )
}

export default AppearanceConfig
