// Noctur: error toasts that can carry the subscription's support link, for errors from the core
// (main/noctur/core-errors.ts) and from profile actions in this window.
import { toast } from 'sonner'
import i18n from '@renderer/i18n'

/** An error toast; with a support link it has a Support button that opens the link. */
export function errorToast(title: string, description?: string, supportUrl?: string): void {
  toast.error(title, {
    description,
    action: supportUrl
      ? { label: i18n.t('pages.profiles.support'), onClick: () => window.open(supportUrl) }
      : undefined
  })
}

/**
 * A failed profile action: when the core refused the profile's config (main/noctur/core-errors.ts
 * starts that message with "Profile Check Failed:"), the profile's support link comes with it.
 */
export function profileErrorToast(e: unknown, profile?: ProfileItem): void {
  const message = `${e}`
  errorToast(message, undefined, message.includes('Profile Check Failed') ? profile?.supportUrl : undefined)
}
