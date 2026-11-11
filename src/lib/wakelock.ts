// Keeps the screen on while a session runs. Re-acquires after the page comes back to the foreground.
let sentinel: WakeLockSentinel | null = null
let wanted = false

async function acquire() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible') {
      sentinel = await navigator.wakeLock.request('screen')
    }
  } catch { /* denied or unsupported; the UI warns the user */ }
}
const onVisible = () => { if (wanted && document.visibilityState === 'visible') void acquire() }

export async function holdAwake(): Promise<boolean> {
  wanted = true
  document.addEventListener('visibilitychange', onVisible)
  await acquire()
  return sentinel !== null
}
export async function releaseAwake() {
  wanted = false
  document.removeEventListener('visibilitychange', onVisible)
  try { await sentinel?.release() } catch { /* already released */ }
  sentinel = null
}
