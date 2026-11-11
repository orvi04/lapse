export const todayLocal = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
export function timeLeft(iso: string) {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return 'archived'
  const h = Math.floor(ms / 3.6e6), m = Math.floor((ms % 3.6e6) / 6e4)
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`
}
export function fmtFocus(sec: number | null) {
  if (!sec) return '0m'
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60)
  return h ? `${h}h ${m}m` : `${m}m`
}
export function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
