// Noctur: core failures the user can act on get their own message. A missing core file is most
// often one an antivirus quarantined (Windows Defender does this to mihomo.exe), so the message says
// so instead of a spawn error. A config the core refuses comes from the subscription, so the message
// offers the subscription's support link when it has one.
import { getCurrentProfileItem } from '../config'
import { showError } from '..'
import { t } from '../utils/i18n'

export class CoreMissingError extends Error {
  constructor(readonly corePath: string) {
    super(`${t('tray.coreMissing')}\n${corePath}`)
    this.name = 'CoreMissingError'
  }
}

/**
 * The core refused the profile's config, in its check before a start or in a hot reload. The
 * message starts with "Profile Check Failed:" in every language, which the window uses to offer
 * the subscription's support link next to the error.
 */
export class ProfileRejectedError extends Error {
  constructor(detail: string) {
    super(`Profile Check Failed:\n${detail}`)
    this.name = 'ProfileRejectedError'
  }
}

/** Shows a core start failure: its own title for a missing core, the support link for a refused config. */
export async function showCoreError(title: string, e: unknown): Promise<void> {
  if (e instanceof CoreMissingError) {
    showError(t('tray.coreMissingTitle'), e.message)
    return
  }
  if (e instanceof ProfileRejectedError) {
    const supportUrl = await getCurrentProfileItem()
      .then((item) => item?.supportUrl)
      .catch(() => undefined)
    showError(title, e.message, supportUrl)
    return
  }
  showError(title, `${e}`)
}
