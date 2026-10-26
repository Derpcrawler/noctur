// Noctur: an error raised while the window is still loading (the first core start runs then) waits
// here until the window asks for it; a page that is not listening yet drops messages sent to it.
export interface PendingError {
  title: string
  message: string
  supportUrl?: string
}

let listening = false
const pending: PendingError[] = []

/** Sends the error to the window if it listens, otherwise keeps it for takePendingErrors. */
export function deliverError(error: PendingError, send: (error: PendingError) => void): void {
  if (listening) send(error)
  else pending.push(error)
}

/** Called by the window once it listens for errors: hands over the kept ones. */
export function takePendingErrors(): PendingError[] {
  listening = true
  return pending.splice(0)
}

/** A page starts loading: it has to ask again before errors are sent to it. */
export function windowLoading(): void {
  listening = false
}
