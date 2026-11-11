import puppeteer from 'puppeteer-core'
import http from 'http'; import fs from 'fs'; import path from 'path'
const root = new URL('../dist', import.meta.url).pathname
const srv = http.createServer((q, s) => {
  let u = q.url.split('?')[0].replace(/^\/lapse/, '') || '/'
  let f = path.join(root, u === '/' ? 'index.html' : u)
  if (!fs.existsSync(f)) f = path.join(root, 'index.html')
  const ext = path.extname(f)
  s.setHeader('content-type', { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/json' }[ext] ?? 'application/octet-stream')
  s.end(fs.readFileSync(f))
}).listen(8766)
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] })
const p = await b.newPage()
await p.setViewport({ width: 390, height: 844 })
let mode = 'invalid'; const calls = []
await p.setRequestInterception(true)
p.on('request', r => {
  const u = r.url()
  if (u.includes('supabase.co')) {
    calls.push(r.method() + ' ' + u.replace(/^https:\/\/[^/]+/, ''))
    if (mode === 'network') return r.abort('failed')
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
    if (r.method() === 'OPTIONS') return r.respond({ status: 204, headers: cors })
    return r.respond({ status: 400, contentType: 'application/json', headers: cors, body: JSON.stringify({ code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }) })
  }
  if (u.startsWith('http://localhost')) return r.continue()
  return r.abort()
})
await p.evaluateOnNewDocument(() => { try { localStorage.clear() } catch {} })
await p.goto('http://localhost:8766/lapse/', { waitUntil: 'networkidle0' })
const results = []
const ok = async (name, cond, extra = '') => results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}${cond ? '' : '\n        page said: ' + JSON.stringify((await p.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | '))}`)
const text = () => p.evaluate(() => document.body.innerText)
const type = async (sel, v) => { await p.$eval(sel, e => { e.focus(); e.select() }); await p.keyboard.press('Backspace'); await p.type(sel, v) }
const pw = () => p.$$eval('input[type=password],input[aria-label*="assword"]', els => els.map(e => ({ label: e.getAttribute('aria-label'), type: e.type })))

// 1. sign-in view
let fields = await pw()
await ok('sign-in shows one password field', fields.length === 1, JSON.stringify(fields))
let t = await text()
await ok('sign-in shows no length rule', !/characters/i.test(t))

// 2. very short password at sign-in -> request goes out, generic message only
await type('input[type=email]', 'someone@example.com')
await type('input[aria-label="Password"]', 'abc')
await p.click('button.btn:not(.ghost)')
await p.waitForFunction(() => /Incorrect email or password/.test(document.body.innerText), { timeout: 5000 }).catch(() => {})
t = await text()
await ok('short password at sign-in gets the generic error', /Incorrect email or password\./.test(t))
await ok('no password hints at sign-in', !/characters|too short|weak|at least/i.test(t), t.match(/.*(characters|short|weak|at least).*/i)?.[0] ?? '')
await ok('short password was still sent to the server (no client hint)', calls.some(c => c.includes('/auth/v1/token')))

// 3. wrong but long password -> same message
await type('input[aria-label="Password"]', 'a-much-longer-wrong-password')
await p.click('button.btn:not(.ghost)')
await new Promise(r => setTimeout(r, 600))
t = await text()
await ok('wrong long password gets identical message', /Incorrect email or password\./.test(t))

// 4. show / hide
await ok('password hidden by default', (await pw())[0].type === 'password')
await p.click('button[aria-label="Show password"]')
await ok('Show reveals the password', (await pw())[0].type === 'text')
await p.click('button[aria-label="Hide password"]')
await ok('Hide hides it again', (await pw())[0].type === 'password')

// 5. network failure -> neutral message
mode = 'network'
await p.click('button.btn:not(.ghost)')
await new Promise(r => setTimeout(r, 800))
t = await text()
await ok('network failure shows neutral message', /Something went wrong/.test(t) && !/Incorrect/.test(t))
mode = 'invalid'

// 6. switch to sign-up
await p.evaluate(() => [...document.querySelectorAll('button.link')].find(b => b.innerText.includes('Create account')).click())
await new Promise(r => setTimeout(r, 200))
fields = await pw()
await ok('sign-up shows two password fields', fields.length === 2, JSON.stringify(fields.map(f => f.label)))
await ok('fields cleared when switching mode', (await p.$eval('input[aria-label="Password"]', e => e.value)) === '')
t = await text()
await ok('sign-up states the length rule', /At least 8 characters/.test(t))

// 7. sign-up validation
await type('input[type=email]', 'new@example.com')
await type('input[aria-label="Password"]', 'short')
await type('input[aria-label="Confirm password"]', 'short')
const before = calls.length
await p.click('button.btn:not(.ghost)')
await new Promise(r => setTimeout(r, 300))
t = await text()
await ok('short password at sign-up shows the rule', /at least 8 characters/i.test(t))
await ok('and does not call the server', calls.length === before)

await type('input[aria-label="Password"]', 'long-enough-1')
await type('input[aria-label="Confirm password"]', 'long-enough-2')

await p.click('button.btn:not(.ghost)')
await new Promise(r => setTimeout(r, 300))
t = await text()
await ok('mismatched confirmation is rejected', /passwords don't match/i.test(t))
await ok('and does not call the server', calls.length === before)

await type('input[aria-label="Confirm password"]', 'long-enough-1')
await p.click('button.btn:not(.ghost)')
await new Promise(r => setTimeout(r, 600))
await ok('matching passwords call the server', calls.length > before)
t = await text()
await ok('sign-up failure message does not reveal account details', /couldn't create that account/i.test(t))

console.log(results.join('\n'))
console.log(results.some(r => r.startsWith('FAIL')) ? '\nSOME FAILED' : '\nALL PASSED')
await b.close(); srv.close()
