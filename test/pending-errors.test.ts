// An error raised while the window is still loading, such as a failed first core start, is kept
// until the window asks for it instead of being sent into a page that drops it; a reloading page
// has to ask again.
import { describe, expect, it } from 'vitest'
import { deliverError, takePendingErrors, windowLoading } from '../src/main/noctur/pending-errors'

describe('errors before the window listens', () => {
  it('keeps an error raised while the window loads until the window asks for it', () => {
    const sent: string[] = []
    const send = (e: { title: string }): void => {
      sent.push(e.title)
    }
    windowLoading()
    deliverError({ title: 'Core not found', message: '' }, send)
    expect(sent).toEqual([])
    expect(takePendingErrors().map((e) => e.title)).toEqual(['Core not found'])
    deliverError({ title: 'later', message: '' }, send)
    expect(sent).toEqual(['later'])
    windowLoading()
    deliverError({ title: 'during a reload', message: '' }, send)
    expect(sent).toEqual(['later'])
  })
})
