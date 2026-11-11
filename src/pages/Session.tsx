import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase, type Post } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { FrameStore, encodeTimelapse, fitSize, type Encoded } from '../lib/timelapse'
import { holdAwake, releaseAwake } from '../lib/wakelock'
import { fmtFocus, todayLocal } from '../lib/time'

type Phase = 'setup' | 'running' | 'review' | 'saving'
type Kind = 'focus' | 'break'

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export default function Session() {
  const { session } = useAuth()
  const uid = session!.user.id
  const nav = useNavigate()
  const [params] = useSearchParams()

  const [phase, setPhase] = useState<Phase>('setup')
  const [posts, setPosts] = useState<Post[]>([])
  const [postId, setPostId] = useState<string>(params.get('post') ?? '')
  const [focusMin, setFocusMin] = useState(25)
  const [breakMin, setBreakMin] = useState(5)
  const [facing, setFacing] = useState<'user' | 'environment'>('user')
  const [record, setRecord] = useState(true)
  const [err, setErr] = useState('')
  const [awake, setAwake] = useState(true)

  // running display state
  const [, setTick] = useState(0)
  const [kind, setKind] = useState<Kind>('focus')
  const [peek, setPeek] = useState(false)
  const [camLost, setCamLost] = useState(false)
  const [notice, setNotice] = useState('')

  // review state
  const [enc, setEnc] = useState<Encoded | null>(null)
  const [encPct, setEncPct] = useState(0)
  const [encErr, setEncErr] = useState('')
  const [videoUrl, setVideoUrl] = useState('')
  const [caption, setCaption] = useState('')
  const [summary, setSummary] = useState({ focusSec: 0, blocks: 0, breaks: 0, awaySec: 0 })

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const storeRef = useRef(new FrameStore())
  const dimsRef = useRef({ w: 540, h: 960 })
  const dimsSet = useRef(false)
  const audioRef = useRef<AudioContext | null>(null)
  const S = useRef({
    kind: 'focus' as Kind, phaseStart: 0, phaseLen: 0, focusMs: 0, awayMs: 0, lastTick: 0,
    blocks: 0, breaks: 0, running: false, capturing: false,
  })
  const cfg = useRef({ focusMin: 25, breakMin: 5, facing: 'user' as 'user' | 'environment', record: true })

  useEffect(() => {
    supabase.from('posts')
      .select('id,author_id,kind,provenance,media_id,caption,focus_seconds,blocks_count,breaks_count,local_date,created_at,feed_expires_at')
      .eq('author_id', uid).is('media_id', null).eq('focus_seconds', 0).order('created_at', { ascending: false }).limit(30)
      .then(({ data }) => setPosts((data as Post[]) ?? []))
  }, [uid])

  // ---- camera ----
  const startCamera = useCallback(async () => {
    const portrait = window.innerHeight >= window.innerWidth
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: cfg.current.facing },
        width: { ideal: portrait ? 720 : 1280 }, height: { ideal: portrait ? 1280 : 720 },
      },
    })
    streamRef.current = stream
    stream.getVideoTracks()[0]?.addEventListener('ended', () => setCamLost(true))
    const v = videoRef.current!
    v.srcObject = stream
    await v.play()
    if (v.videoWidth && !dimsSet.current) { dimsRef.current = fitSize(v.videoWidth, v.videoHeight); dimsSet.current = true }
    setCamLost(false)
  }, [])
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  const grabFrame = useCallback(async () => {
    const v = videoRef.current
    if (!v || v.readyState < 2 || !v.videoWidth) return
    const { w, h } = dimsRef.current
    let c = canvasRef.current
    if (!c) { c = document.createElement('canvas'); canvasRef.current = c }
    c.width = w; c.height = h
    c.getContext('2d')!.drawImage(v, 0, 0, w, h)
    const blob = await new Promise<Blob | null>(res => c!.toBlob(res, 'image/jpeg', 0.72))
    if (blob) storeRef.current.add(blob)
  }, [])

  // capture loop: only while focusing, page visible, camera live
  useEffect(() => {
    if (phase !== 'running') return
    let timer: number
    const loop = async () => {
      const s = S.current
      if (s.running && s.kind === 'focus' && cfg.current.record && document.visibilityState === 'visible' && streamRef.current) {
        try { await grabFrame() } catch { /* skip this frame */ }
      }
      timer = window.setTimeout(loop, storeRef.current.intervalMs)
    }
    timer = window.setTimeout(loop, 500)
    return () => window.clearTimeout(timer)
  }, [phase, grabFrame])

  // ---- timer / blocks ----
  const chime = useCallback(() => {
    try {
      const ctx = audioRef.current
      if (ctx) {
        const o = ctx.createOscillator(); const g = ctx.createGain()
        o.frequency.value = 660; g.gain.value = 0.15
        o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.25)
      }
      navigator.vibrate?.([200, 100, 200])
    } catch { /* optional */ }
  }, [])

  const enterPhase = useCallback((k: Kind, now: number, silent: boolean) => {
    const s = S.current
    s.kind = k; s.phaseStart = now
    s.phaseLen = (k === 'focus' ? cfg.current.focusMin : cfg.current.breakMin) * 60000
    if (k === 'focus') s.blocks += 1; else s.breaks += 1
    setKind(k); setPeek(false)
    if (!silent) chime()
    if (cfg.current.record) {
      if (k === 'break') stopCamera()
      else if (!streamRef.current) startCamera().catch(() => setCamLost(true))
    }
  }, [chime, startCamera, stopCamera])

  useEffect(() => {
    if (phase !== 'running') return
    const id = window.setInterval(() => {
      const s = S.current
      if (!s.running) return
      const now = Date.now()
      const visible = document.visibilityState === 'visible'
      const gap = now - s.lastTick
      if (gap > 3000) {
        s.awayMs += gap
        setNotice(`You were away for ${fmtFocus(Math.round(gap / 1000))}. That time isn't counted as focus.`)
      } else if (visible && s.kind === 'focus') {
        s.focusMs += gap
      }
      s.lastTick = now
      // advance through any blocks that finished (several if we were away)
      let guard = 0
      while (now >= s.phaseStart + s.phaseLen && guard++ < 200) {
        const end = s.phaseStart + s.phaseLen
        const next: Kind = s.kind === 'focus' ? 'break' : 'focus'
        const last = now < end + (next === 'focus' ? cfg.current.focusMin : cfg.current.breakMin) * 60000
        enterPhase(next, end, !last)
      }
      setTick(t => t + 1)
    }, 500)
    return () => window.clearInterval(id)
  }, [phase, enterPhase])

  useEffect(() => { if (!peek) return; const t = setTimeout(() => setPeek(false), 4000); return () => clearTimeout(t) }, [peek])
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(''), 8000); return () => clearTimeout(t) }, [notice])

  // re-acquire the camera after coming back to the foreground
  useEffect(() => {
    if (phase !== 'running') return
    const onVis = () => {
      if (document.visibilityState === 'visible' && cfg.current.record && S.current.kind === 'focus' && !streamRef.current) {
        startCamera().catch(() => setCamLost(true))
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [phase, startCamera])

  useEffect(() => () => { stopCamera(); void releaseAwake() }, [stopCamera])

  // ---- actions ----
  async function start() {
    setErr('')
    cfg.current = { focusMin, breakMin, facing, record }
    storeRef.current = new FrameStore()
    dimsRef.current = { w: 540, h: 960 }; dimsSet.current = false
    try { audioRef.current = new AudioContext() } catch { /* no chime */ }
    if (record) {
      try { await startCamera() } catch (e) {
        return setErr(`Couldn't open the camera (${e instanceof Error ? e.message : 'blocked'}). Allow camera access, or turn off "Record timelapse" to just log your time.`)
      }
    }
    setAwake(await holdAwake())
    const now = Date.now()
    const s = S.current
    Object.assign(s, { focusMs: 0, awayMs: 0, blocks: 0, breaks: 0, lastTick: now, running: true })
    enterPhase('focus', now, true)
    setPhase('running')
  }

  async function finish() {
    const s = S.current
    s.running = false
    const now = Date.now()
    if (s.kind === 'focus' && now - s.lastTick <= 3000) s.focusMs += now - s.lastTick
    stopCamera(); await releaseAwake()
    setSummary({ focusSec: Math.round(s.focusMs / 1000), blocks: s.blocks, breaks: Math.max(0, s.breaks), awaySec: Math.round(s.awayMs / 1000) })
    setPhase('review')
    setEnc(null); setEncErr(''); setVideoUrl('')
    const frames = storeRef.current.frames
    if (cfg.current.record && frames.length >= 2) {
      try {
        const out = await encodeTimelapse(frames, dimsRef.current.w, dimsRef.current.h, setEncPct)
        setEnc(out); setVideoUrl(URL.createObjectURL(out.blob))
      } catch (e) { setEncErr(e instanceof Error ? e.message : 'Could not make the video') }
    } else if (cfg.current.record) {
      setEncErr('Not enough footage was captured to make a timelapse.')
    }
  }

  async function upload(bucket: string, path: string, body: Blob, type: string) {
    let last: unknown
    for (let i = 0; i < 3; i++) {
      const { error } = await supabase.storage.from(bucket).upload(path, body, { contentType: type, upsert: true })
      if (!error) return
      last = error
      await new Promise(r => setTimeout(r, 800 * (i + 1)))
    }
    throw last
  }

  async function save(withVideo: boolean) {
    setErr(''); setPhase('saving')
    try {
      let mediaId: string | null = null
      if (withVideo && enc) {
        if (enc.blob.size > 40 * 1024 * 1024) throw new Error('The video is too large to upload.')
        mediaId = crypto.randomUUID()
        const path = `${uid}/${mediaId}.mp4`
        const thumbPath = `${uid}/${mediaId}.jpg`
        const frames = storeRef.current.frames
        await upload('timelapses', path, enc.blob, 'video/mp4')
        await upload('thumbnails', thumbPath, frames[Math.floor(frames.length / 2)], 'image/jpeg')
        const { error: e1 } = await supabase.from('media').insert({
          id: mediaId, owner_id: uid, storage_path: path, thumb_path: thumbPath,
          duration_ms: enc.durationMs, frame_count: frames.length, width: dimsRef.current.w, height: dimsRef.current.h,
          codec: 'h264', bytes: enc.blob.size, capture_interval_s: Math.round(storeRef.current.intervalMs / 10) / 100,
        })
        if (e1) throw e1
        const { error: e2 } = await supabase.from('media').update({ upload_status: 'uploaded' }).eq('id', mediaId)
        if (e2) throw e2
      }
      const { error } = await supabase.rpc('finish_session', {
        p_post: postId || null, p_media: mediaId, p_focus_seconds: summary.focusSec,
        p_blocks: summary.blocks, p_breaks: summary.breaks, p_caption: caption,
        p_local_date: todayLocal(), p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      })
      if (error) throw error
      if (videoUrl) URL.revokeObjectURL(videoUrl)
      nav('/')
    } catch (e) {
      setErr((e as { message?: string })?.message ?? 'Could not save. Try again.')
      setPhase('review')
    }
  }

  // ---- render ----
  const s = S.current
  const left = s.phaseStart + s.phaseLen - Date.now()

  if (phase === 'setup') {
    return (
      <div className="screen">
        <h2 className="title">Start a session</h2>
        <p className="sub">Your phone stays on and the screen goes black while you focus. A timelapse is recorded from the camera.</p>
        <div className="card">
          <label className="muted">Post this session belongs to</label>
          <select className="input" value={postId} onChange={e => setPostId(e.target.value)}>
            <option value="">New post (no plan)</option>
            {posts.map(p => <option key={p.id} value={p.id}>{p.caption || 'Untitled'} · {new Date(p.created_at).toLocaleDateString()}</option>)}
          </select>
          <div className="row">
            <div className="grow"><label className="muted">Focus (min)</label>
              <input className="input" type="number" min={1} max={180} value={focusMin} onChange={e => setFocusMin(Math.max(1, Number(e.target.value) || 1))} /></div>
            <div className="grow"><label className="muted">Break (min)</label>
              <input className="input" type="number" min={1} max={60} value={breakMin} onChange={e => setBreakMin(Math.max(1, Number(e.target.value) || 1))} /></div>
          </div>
          <label className="row" style={{ marginBottom: 12 }}>
            <input type="checkbox" checked={record} onChange={e => setRecord(e.target.checked)} />
            <span>Record timelapse</span>
          </label>
          {record && (
            <div className="row" style={{ marginBottom: 12 }}>
              <button className={'btn small ' + (facing === 'user' ? '' : 'ghost')} onClick={() => setFacing('user')}>Front camera</button>
              <button className={'btn small ' + (facing === 'environment' ? '' : 'ghost')} onClick={() => setFacing('environment')}>Back camera</button>
            </div>
          )}
          {err && <div className="err">{err}</div>}
          <button className="btn" onClick={start}>Start focusing</button>
          <p className="muted" style={{ marginBottom: 0 }}>Stay in this app while you record. Switching away pauses the camera and that time isn't counted. Plugging in is a good idea for long sessions.</p>
        </div>
      </div>
    )
  }

  if (phase === 'running') {
    const dark = kind === 'focus' && !peek
    return (
      <>
        <video ref={videoRef} playsInline muted autoPlay style={{ position: 'fixed', width: 2, height: 2, opacity: 0.01, pointerEvents: 'none', left: 0, top: 0 }} />
        {dark && (
          <div onClick={() => setPeek(true)} style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 100, display: 'grid', placeItems: 'center', color: '#2a2a2e' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: 'Space Grotesk', fontSize: 40 }}>{mmss(left)}</div>
              <div style={{ fontSize: 12, marginTop: 8 }}>Tap to show controls</div>
            </div>
          </div>
        )}
        <div className="screen">
          <h2 className="title">{kind === 'focus' ? 'Focusing' : 'Break'}</h2>
          <p className="sub">Block {s.blocks}{kind === 'break' ? ' done' : ''} · {fmtFocus(Math.round(s.focusMs / 1000))} focused</p>
          <div className="card" style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: 'Space Grotesk', fontSize: 64, fontWeight: 700 }}>{mmss(left)}</div>
            <div className="muted">{kind === 'focus' ? 'until your break' : 'until the next focus block'}</div>
          </div>
          {!awake && <div className="err">Couldn't keep the screen awake. Turn off auto-lock in your phone settings for this session.</div>}
          {camLost && cfg.current.record && kind === 'focus' && <div className="err">Camera paused. It will resume when it's available.</div>}
          {notice && <div className="ok">{notice}</div>}
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn ghost" onClick={() => { const n = Date.now(); enterPhase(kind === 'focus' ? 'break' : 'focus', n, true) }}>
              {kind === 'focus' ? 'Take a break' : 'Skip break'}
            </button>
            <button className="btn" onClick={finish}>Finish</button>
          </div>
        </div>
      </>
    )
  }

  // review / saving
  return (
    <div className="screen">
      <h2 className="title">Session complete</h2>
      <div className="card">
        <div className="stats" style={{ marginTop: 0 }}>
          <div className="stat"><b>{fmtFocus(summary.focusSec)}</b><span className="muted">focused</span></div>
          <div className="stat"><b>{summary.blocks}</b><span className="muted">blocks</span></div>
          <div className="stat"><b>{summary.breaks}</b><span className="muted">breaks</span></div>
          {summary.awaySec > 0 && <div className="stat"><b>{fmtFocus(summary.awaySec)}</b><span className="muted">away</span></div>}
        </div>
      </div>
      {videoUrl
        ? <video src={videoUrl} controls playsInline loop autoPlay muted style={{ width: '100%', borderRadius: 12, marginBottom: 12, background: '#000' }} />
        : record && !encErr && <div className="card muted">Making your timelapse… {Math.round(encPct * 100)}%</div>}
      {encErr && <div className="err">{encErr} You can still post your focus time without video.</div>}
      <textarea className="input" rows={2} maxLength={280} placeholder="Add a caption (optional)" value={caption} onChange={e => setCaption(e.target.value)} />
      {err && <div className="err">{err}</div>}
      <button className="btn" disabled={phase === 'saving' || (record && !enc && !encErr)} onClick={() => save(Boolean(enc))}>
        {phase === 'saving' ? 'Posting…' : enc ? 'Post with timelapse' : 'Post focus time'}
      </button>
      <button className="btn ghost" style={{ marginTop: 10 }} disabled={phase === 'saving'} onClick={() => { if (confirm('Discard this session?')) nav('/') }}>Discard</button>
    </div>
  )
}
