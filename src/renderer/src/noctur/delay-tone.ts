// Noctur: delay colors: green below 200 ms, orange from 200 to 350 ms, red above
// 350 ms; a timeout (0) is red and marked as one. Used on Home and the Proxy Groups page.

export type DelayTone = 'good' | 'slow' | 'bad'

export function delayTone(ms: number): DelayTone {
  if (ms < 200) return 'good'
  if (ms <= 350) return 'slow'
  return 'bad'
}
