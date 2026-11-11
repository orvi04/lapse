import { Muxer, ArrayBufferTarget } from 'mp4-muxer'

// Keeps a bounded number of frames for any session length: when the cap is hit we drop
// every other frame and double the capture interval.
export class FrameStore {
  frames: Blob[] = []
  ids: number[] = []
  intervalMs: number
  readonly maxFrames: number
  private nextId = 0
  constructor(intervalMs = 2000, maxFrames = 600) {
    this.intervalMs = intervalMs
    this.maxFrames = maxFrames
  }
  // Returns the new frame's id and the ids dropped by decimation (so storage can be kept in step).
  add(b: Blob): { id: number; dropped: number[] } {
    const id = this.nextId++
    this.frames.push(b); this.ids.push(id)
    const dropped: number[] = []
    if (this.frames.length > this.maxFrames) {
      const keepF: Blob[] = []; const keepI: number[] = []
      this.frames.forEach((f, i) => { if (i % 2 === 0) { keepF.push(f); keepI.push(this.ids[i]) } else dropped.push(this.ids[i]) })
      this.frames = keepF; this.ids = keepI
      this.intervalMs *= 2
    }
    return { id, dropped }
  }
  // Rebuild from recovered frames (already decimated), continuing id numbering.
  restore(items: { id: number; blob: Blob }[], intervalMs: number) {
    this.frames = items.map(i => i.blob); this.ids = items.map(i => i.id)
    this.nextId = (items.at(-1)?.id ?? -1) + 1
    this.intervalMs = intervalMs
  }
}

export const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2)

export function fitSize(vw: number, vh: number, maxSide = 960) {
  const s = Math.min(1, maxSide / Math.max(vw, vh))
  return { w: even(vw * s), h: even(vh * s) }
}

export function pickFps(frames: number) {
  return Math.min(30, Math.max(6, Math.round(frames / 15)))
}

export type Encoded = { blob: Blob; durationMs: number; fps: number }

export async function encodeTimelapse(frames: Blob[], w: number, h: number, onProgress: (p: number) => void): Promise<Encoded> {
  if (frames.length < 2) throw new Error('Not enough frames to make a timelapse')
  const fps = pickFps(frames.length)
  const durationMs = Math.round((frames.length / fps) * 1000)
  if (typeof VideoEncoder !== 'undefined') {
    try { return { blob: await encodeWebCodecs(frames, w, h, fps, onProgress), durationMs, fps } } catch (e) {
      console.warn('WebCodecs encode failed, trying MediaRecorder', e)
    }
  }
  return { blob: await encodeMediaRecorder(frames, w, h, fps, onProgress), durationMs, fps }
}

async function encodeWebCodecs(frames: Blob[], w: number, h: number, fps: number, onProgress: (p: number) => void) {
  const candidates = ['avc1.42001f', 'avc1.4d001f', 'avc1.640028']
  let config: VideoEncoderConfig | null = null
  for (const codec of candidates) {
    const c: VideoEncoderConfig = { codec, width: w, height: h, bitrate: 2_000_000, framerate: fps }
    if ((await VideoEncoder.isConfigSupported(c)).supported) { config = c; break }
  }
  if (!config) throw new Error('No supported H.264 encoder')
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: w, height: h }, fastStart: 'in-memory' })
  let failure: unknown = null
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: e => { failure = e },
  })
  encoder.configure(config)
  const dur = 1_000_000 / fps
  for (let i = 0; i < frames.length; i++) {
    if (failure) throw failure
    const bmp = await createImageBitmap(frames[i])
    const vf = new VideoFrame(bmp, { timestamp: Math.round(i * dur), duration: Math.round(dur) })
    encoder.encode(vf, { keyFrame: i % 30 === 0 })
    vf.close(); bmp.close()
    while (encoder.encodeQueueSize > 8) await new Promise(r => setTimeout(r, 5))
    if (i % 10 === 0) onProgress(i / frames.length)
  }
  await encoder.flush()
  if (failure) throw failure
  encoder.close()
  muxer.finalize()
  onProgress(1)
  return new Blob([(muxer.target as ArrayBufferTarget).buffer], { type: 'video/mp4' })
}

// Fallback for browsers without WebCodecs: play the frames onto a canvas and record it.
async function encodeMediaRecorder(frames: Blob[], w: number, h: number, fps: number, onProgress: (p: number) => void) {
  if (typeof MediaRecorder === 'undefined') throw new Error('This browser cannot create video')
  const mime = ['video/mp4;codecs=avc1', 'video/mp4'].find(m => MediaRecorder.isTypeSupported(m))
  if (!mime) throw new Error('This browser cannot record MP4 video')
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')!
  const stream = canvas.captureStream(fps)
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_000_000 })
  const chunks: Blob[] = []
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
  const done = new Promise<void>(res => { rec.onstop = () => res() })
  rec.start(500)
  for (let i = 0; i < frames.length; i++) {
    const bmp = await createImageBitmap(frames[i])
    ctx.drawImage(bmp, 0, 0, w, h); bmp.close()
    onProgress(i / frames.length)
    await new Promise(r => setTimeout(r, 1000 / fps))
  }
  rec.stop()
  await done
  onProgress(1)
  return new Blob(chunks, { type: 'video/mp4' })
}
