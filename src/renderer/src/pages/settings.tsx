import { Button } from '@renderer/components/ui/button'
import BasePage from '@renderer/components/base/base-page'
import GeneralConfig from '@renderer/components/settings/general-config'
import AdvancedSettings from '@renderer/components/settings/advanced-settings'
import Actions from '@renderer/components/settings/actions'
import ShortcutConfig from '@renderer/components/settings/shortcut-config'
import AppearanceConfig from '@renderer/components/settings/appearance-confis'
import LanguageConfig from '@renderer/components/settings/language-config'
import ProxySwitches from '@renderer/components/settings/proxy-switches'
import { useTranslation } from 'react-i18next'
import { Github } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

// Noctur: one page with a section index on the left.
const SECTIONS = [
  { id: 'connection', label: 'noctur.settings.connection' },
  { id: 'general', label: 'noctur.settings.general' },
  { id: 'appearance', label: 'noctur.settings.appearance' },
  { id: 'advanced', label: 'noctur.settings.advanced' },
  { id: 'shortcuts', label: 'noctur.settings.shortcuts' },
  { id: 'about', label: 'noctur.settings.about' }
]

const Settings: React.FC = () => {
  const { t } = useTranslation()
  const [showHiddenSettings, setShowHiddenSettings] = useState(false)
  const [current, setCurrent] = useState('connection')
  const navRef = useRef<HTMLElement>(null)
  // After a click, keep the clicked section highlighted while the page scrolls to it.
  const clickedUntil = useRef(0)

  // Highlight the section whose heading has passed the top of the page; the last one at the bottom.
  useEffect(() => {
    const scroller = navRef.current?.closest('.noctur-content') as HTMLElement | null
    if (!scroller) return
    const update = (): void => {
      if (Date.now() < clickedUntil.current) return
      const top = scroller.getBoundingClientRect().top
      let active = SECTIONS[0].id
      for (const sec of SECTIONS) {
        const el = document.getElementById(`set-${sec.id}`)
        if (el && el.getBoundingClientRect().top - top <= 80) active = sec.id
      }
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4) {
        active = SECTIONS[SECTIONS.length - 1].id
      }
      setCurrent(active)
    }
    scroller.addEventListener('scroll', update, { passive: true })
    update()
    return (): void => scroller.removeEventListener('scroll', update)
  }, [])

  return (
    <BasePage
      title={t('pages.settings.title')}
      header={
        <>
          <Button
            size="icon-sm"
            variant="ghost"
            className="app-nodrag"
            title={t('pages.settings.githubRepo')}
            onClick={() => {
              window.open('https://github.com/Derpcrawler/noctur')
            }}
          >
            <Github className="text-lg" />
          </Button>
        </>
      }
    >
      <div className="noctur-settings">
        <nav ref={navRef} className="noctur-subnav" aria-label="Sections">
          {SECTIONS.map((sec) => (
            <button
              key={sec.id}
              type="button"
              aria-current={current === sec.id}
              onClick={() => {
                setCurrent(sec.id)
                clickedUntil.current = Date.now() + 800
                document
                  .getElementById(`set-${sec.id}`)
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
            >
              {t(sec.label)}
            </button>
          ))}
        </nav>
        <div className="min-w-0">
          <div id="set-connection">
            <h3 className="noctur-sec-title">{t('noctur.settings.connection')}</h3>
            <ProxySwitches />
          </div>
          <div id="set-general">
            <h3 className="noctur-sec-title">{t('noctur.settings.general')}</h3>
            <GeneralConfig showHiddenSettings={showHiddenSettings} />
            <LanguageConfig />
          </div>
          <div id="set-appearance">
            <AppearanceConfig showHiddenSettings={showHiddenSettings} />
          </div>
          <div id="set-advanced">
            <AdvancedSettings showHiddenSettings={showHiddenSettings} />
          </div>
          <div id="set-shortcuts">
            <ShortcutConfig />
          </div>
          <div id="set-about">
            <h3 className="noctur-sec-title">{t('noctur.settings.about')}</h3>
            <Actions
              showHiddenSettings={showHiddenSettings}
              onUnlockHiddenSettings={() => setShowHiddenSettings(true)}
            />
            {/* Noctur: GPL-3.0 credits, shown on every platform. */}
            <p className="noctur-credits">{t('noctur.about.credits')}</p>
          </div>
        </div>
      </div>
    </BasePage>
  )
}

export default Settings
