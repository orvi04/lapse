// Smoke test: runs the built app in headless Chrome against a mocked Supabase backend.
import puppeteer from 'puppeteer-core'
import http from 'http'; import fs from 'fs'; import path from 'path'

const root = new URL('../dist', import.meta.url).pathname
const srv = http.createServer((q, s) => {
  const u = q.url.split('?')[0].replace(/^\/lapse/, '') || '/'
  let f = path.join(root, u === '/' ? 'index.html' : u)
  if (!fs.existsSync(f)) f = path.join(root, 'index.html')
  s.setHeader('content-type', { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/json' }[path.extname(f)] ?? 'application/octet-stream')
  s.end(fs.readFileSync(f))
}).listen(8767)

const ME = '00000000-0000-4000-8000-000000000001'
const BOB = '00000000-0000-4000-8000-000000000002'
const iso = (h) => new Date(Date.now() + h * 3600e3).toISOString()
const PROFILES = {
  [ME]: { id: ME, username: 'orvi', display_name: 'Orvi', avatar_path: null, timezone: 'Europe/London' },
  [BOB]: { id: BOB, username: 'bobby', display_name: 'Bobby', avatar_path: null, timezone: 'Europe/London' },
}
const post = (id, author, caption, extra = {}) => ({ id, author_id: author, kind: 'solo', provenance: 'logged', media_id: null, caption,
  focus_seconds: 0, blocks_count: 0, breaks_count: 0, local_date: '2026-11-11', created_at: iso(-2), feed_expires_at: iso(22), ...extra })
const POSTS = [
  post('p-bob', BOB, 'Bobby deep work'),
  post('p-me', ME, 'My recorded session', { provenance: 'captured', media_id: 'm1', focus_seconds: 5400, blocks_count: 3 }),
  post('p-old', ME, 'Old archived post', { created_at: iso(-80), feed_expires_at: iso(-56) }),
]
const PROMISES = [
  { id: 'i1', post_id: 'p-bob', user_id: BOB, position: 1, text: 'read paper', status: 'fulfilled', fulfilled_at: iso(-1) },
  { id: 'i2', post_id: 'p-bob', user_id: BOB, position: 2, text: 'write intro', status: 'pending', fulfilled_at: null },
]
const COMMENTS = [{ id: 'c1', author_id: BOB, username: 'bobby', display_name: 'Bobby', body: 'great work', created_at: iso(-1) }]
let pins = [{ post_id: 'p-me', user_id: ME, position: 1 }, { post_id: 'p-bob', user_id: BOB, position: 1 }]

const calls = []
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }
const json = (r, body, status = 200) => r.respond({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) })

function inList(url, col) {
  const m = new URL(url).searchParams.get(col)
  return m?.startsWith('in.(') ? m.slice(4, -1).split(',').map(x => x.replace(/"/g, '')) : null
}
function eq(url, col) { const v = new URL(url).searchParams.get(col); return v?.startsWith('eq.') ? v.slice(3) : null }

async function mock(r) {
  const u = r.url(); const { pathname } = new URL(u); const method = r.method()
  if (method === 'OPTIONS') return r.respond({ status: 204, headers: cors })
  const single = (r.headers()['accept'] ?? '').includes('vnd.pgrst.object')
  const send = (rows) => json(r, single ? (rows[0] ?? null) : rows, single && rows.length === 0 ? 406 : 200)
  calls.push(`${method} ${pathname}${new URL(u).search.slice(0, 80)} ${method === 'POST' ? (r.postData() ?? '').slice(0, 100) : ''}`)

  if (pathname.startsWith('/auth/v1/user')) return json(r, { id: ME, aud: 'authenticated', email: 'o@example.com' })
  if (pathname === '/rest/v1/profiles') {
    const ids = inList(u, 'id'); const id = eq(u, 'id'); const un = eq(u, 'username')
    let rows = Object.values(PROFILES)
    if (ids) rows = rows.filter(p => ids.includes(p.id)); if (id) rows = rows.filter(p => p.id === id); if (un) rows = rows.filter(p => p.username === un)
    return send(rows)
  }
  if (pathname === '/rest/v1/posts') {
    const ids = inList(u, 'id'); const author = eq(u, 'author_id')
    let rows = POSTS
    if (ids) rows = rows.filter(p => ids.includes(p.id))
    if (author) rows = rows.filter(p => p.author_id === author)
    if ((new URL(u).searchParams.get('feed_expires_at') ?? '').startsWith('gt.')) rows = rows.filter(p => new Date(p.feed_expires_at) > new Date())
    return send(rows)
  }
  if (pathname === '/rest/v1/media') return send([{ id: 'm1', thumb_path: `${ME}/m1.jpg`, storage_path: `${ME}/m1.mp4` }])
  if (pathname === '/rest/v1/reactions') return send([{ post_id: 'p-bob', user_id: BOB, kind: 'fire' }])
  if (pathname === '/rest/v1/promises') return send(PROMISES.filter(x => { const ids = inList(u, 'post_id'); return !ids || ids.includes(x.post_id) }))
  if (pathname === '/rest/v1/post_pins') {
    const ids = inList(u, 'post_id'); const uid = eq(u, 'user_id')
    if (method === 'DELETE') { pins = pins.filter(p => p.post_id !== eq(u, 'post_id')); return r.respond({ status: 204, headers: cors }) }
    return send(pins.filter(p => (!ids || ids.includes(p.post_id)) && (!uid || p.user_id === uid)))
  }
  if (pathname === '/rest/v1/comments') return r.respond({ status: 201, headers: cors })
  if (pathname === '/rest/v1/rpc/get_comments') return json(r, COMMENTS)
  if (pathname === '/rest/v1/rpc/pin_post') { pins.push({ post_id: JSON.parse(r.postData()).p_post, user_id: ME, position: 2 }); return json(r, 2) }
  if (pathname === '/rest/v1/rpc/activity_by_day') return json(r, [{ local_date: new Date().toISOString().slice(0, 10), post_count: 1, focus_seconds: 5400 }])
  if (pathname.startsWith('/storage/v1/object/sign/')) return json(r, { signedURL: pathname.replace('/storage/v1', '') + '?token=t' })
  if (pathname.startsWith('/storage/v1/object/')) return r.respond({ status: 200, contentType: 'image/png', headers: cors, body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64') })
  return json(r, [])
}

const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] })
const p = await b.newPage()
await p.setViewport({ width: 390, height: 844 })
const errors = []
p.on('pageerror', e => errors.push('pageerror: ' + e.message))
p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED/.test(m.text())) errors.push('console: ' + m.text()) })
await p.setRequestInterception(true)
p.on('request', r => {
  const u = r.url()
  if (u.includes('supabase.co')) return mock(r).catch(e => { errors.push('mock: ' + e.message); r.abort() })
  if (u.startsWith('http://localhost')) return r.continue()
  return r.abort()
})
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: ME, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 7200 })}.sig`
await p.evaluateOnNewDocument((jwt, ME) => {
  localStorage.setItem('sb-cpjoqrkxfqwefjlqyrmu-auth-token', JSON.stringify({
    access_token: jwt, token_type: 'bearer', expires_in: 7200, expires_at: Math.floor(Date.now() / 1000) + 7200, refresh_token: 'r',
    user: { id: ME, aud: 'authenticated', email: 'o@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01' },
  }))
}, jwt, ME)

const results = []
const text = () => p.evaluate(() => document.body.innerText)
const ok = async (name, cond) => results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '\n        page said: ' + JSON.stringify((await text()).replace(/\n+/g, ' | ').slice(0, 400))}`)
const wait = (ms) => new Promise(r => setTimeout(r, ms))
const clickText = (sel, t) => p.evaluate((sel, t) => { const el = [...document.querySelectorAll(sel)].find(e => e.innerText.includes(t)); el?.click(); return !!el }, sel, t)
const go = async (hash) => { await p.goto('http://localhost:8767/lapse/#' + hash, { waitUntil: 'networkidle0' }); await wait(300) }

// Feed
await go('/')
let t = await text()
await ok('feed shows friend post', t.includes('Bobby deep work'))
await ok('feed shows my recorded post and stats', t.includes('My recorded session') && t.includes('1h 30m'))
await ok('feed hides archived post', !t.includes('Old archived post'))
await ok('checklist shows items and progress', t.includes('read paper') && t.includes('write intro') && t.includes('1/2'))
await ok('pinned chip shows on pinned posts', t.includes('Pinned'))
await ok('friend author name is a profile link', (await p.$$eval('a[href="#/u/bobby"]', a => a.length)) > 0)

// Comments
await p.evaluate(() => document.querySelector('button[aria-label="Comments"]').click()); await wait(400)
t = await text()
await ok('comments load with author name', t.includes('great work') && t.includes('Bobby'))
await p.type('input[placeholder="Add a comment"]', 'thanks!')
await clickText('button', 'Send'); await wait(400)
await ok('sending a comment posts it', calls.some(c => c.startsWith('POST /rest/v1/comments') && c.includes('thanks!')))

// Reaction
await p.evaluate(() => document.querySelector('button[aria-label="React"]').click()); await wait(300)
await ok('reacting calls the API', calls.some(c => c.startsWith('POST /rest/v1/reactions') || c.startsWith('DELETE /rest/v1/reactions')))

// You: archive and pins
await go('/you')
t = await text()
await ok('You shows activity stats', t.includes('last 28 days') && t.includes('1 posts') === false && t.includes('posts'))
await ok('pinned section lists the pinned post', t.includes('Pinned') && t.includes('My recorded session'))
await ok('archive lists older posts', t.includes('Your archive') && t.includes('Old archived post') && t.includes('archived'))
await ok('version line is shown', /Version \d{4}-\d{2}-\d{2}/.test(t))
await clickText('button', 'Pin to profile'); await wait(400)
await ok('Pin calls pin_post', calls.some(c => c.includes('/rpc/pin_post')))

// Friend profile
await go('/u/bobby')
t = await text()
await ok('friend profile shows name and pinned post', t.includes('Bobby') && t.includes('@bobby') && t.includes('Bobby deep work'))
await go('/u/nobody')
t = await text()
await ok('unknown profile shows a neutral message', t.includes("isn't available"))

// Promises + new post + session setup render without crashing
await go('/promises')
await ok('promises screen renders', (await text()).includes('Promises'))
await go('/new')
await ok('new post screen renders both actions', (await text()).includes('Post & start recording') && (await text()).includes('record later'))
await go('/session')
t = await text()
await ok('session setup renders', t.includes('Start focusing') && t.includes('Record timelapse'))
await go('/friends')
await ok('friends screen renders search', (await text()).includes('Search'))

await ok('no runtime errors', errors.length === 0)
if (errors.length) console.log(errors.join('\n'))
console.log(results.join('\n'))
console.log(results.some(r => r.startsWith('FAIL')) ? '\nSOME FAILED' : '\nALL PASSED')
await b.close(); srv.close()
