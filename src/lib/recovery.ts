// Mirrors an in-progress session to IndexedDB so a crash, reload or accidental close doesn't lose the footage.
export type Meta = {
  sid: string
  postId: string
  focusMin: number
  breakMin: number
  facing: 'user' | 'environment'
  startedAt: number
  savedAt: number
  focusMs: number
  awayMs: number
  blocks: number
  breaks: number
  intervalMs: number
  w: number
  h: number
}

const DB = 'lapse-recovery'
let dbp: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1)
      r.onupgradeneeded = () => { r.result.createObjectStore('frames'); r.result.createObjectStore('meta') }
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
  }
  return dbp
}

function run<T>(store: 'frames' | 'meta', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return open().then(db => new Promise<T | undefined>((res, rej) => {
    const tx = db.transaction(store, mode)
    const req = fn(tx.objectStore(store))
    tx.oncomplete = () => res(req ? (req as IDBRequest<T>).result : undefined)
    tx.onerror = () => rej(tx.error)
    tx.onabort = () => rej(tx.error)
  }))
}

const key = (sid: string, id: number) => `${sid}:${String(id).padStart(8, '0')}`

export const putFrame = (sid: string, id: number, blob: Blob) => run('frames', 'readwrite', s => s.put(blob, key(sid, id))).catch(() => undefined)
export const deleteFrames = (sid: string, ids: number[]) =>
  run('frames', 'readwrite', s => { ids.forEach(id => s.delete(key(sid, id))) }).catch(() => undefined)
export const saveMeta = (m: Meta) => run('meta', 'readwrite', s => s.put(m, 'active')).catch(() => undefined)

export async function loadMeta(): Promise<Meta | null> {
  try { return ((await run<Meta>('meta', 'readonly', s => s.get('active'))) ?? null) } catch { return null }
}

export async function loadFrames(sid: string): Promise<{ id: number; blob: Blob }[]> {
  try {
    const range = IDBKeyRange.bound(`${sid}:`, `${sid}:￿`)
    const db = await open()
    return await new Promise((res, rej) => {
      const out: { id: number; blob: Blob }[] = []
      const tx = db.transaction('frames', 'readonly')
      const req = tx.objectStore('frames').openCursor(range)
      req.onsuccess = () => {
        const c = req.result
        if (c) { out.push({ id: Number(String(c.key).split(':')[1]), blob: c.value as Blob }); c.continue() } else res(out)
      }
      req.onerror = () => rej(req.error)
    })
  } catch { return [] }
}

export async function clearRecovery() {
  try {
    await run('frames', 'readwrite', s => s.clear())
    await run('meta', 'readwrite', s => s.clear())
  } catch { /* nothing to clear */ }
}
