import { describe, expect, it } from 'vitest'
import { pickLanguage } from '../src/main/utils/i18n'

// The main process starts in the system's language, so the menu bar menu is in the right language
// from launch, not only once the window has loaded.
describe('main process language at startup', () => {
  it('uses the saved language, else the system language, not Russian', () => {
    expect(pickLanguage('en-US', ['ru-RU'])).toBe('en-US')
    expect(pickLanguage(undefined, ['en-US', 'ru-US'])).toBe('en-US')
  })
})
