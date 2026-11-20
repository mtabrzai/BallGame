'use strict';

// Smoke test: starts the server, connects a fake Fire TV display and a fake
// phone remote over WebSocket, plays the game, and asserts the ball bounces,
// the paddle follows remote input, and scoring works.

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const PORT = 8123;
const BASE = `http://127.0.0.1:${PORT}`;

if (typeof WebSocket === 'undefined') {
  console.error('FAIL: this test needs Node >= 22 (global WebSocket).');
  process.exit(1);
}

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`PASS: ${name}`);
  else { console.log(`FAIL: ${name}`); failures++; }
}

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

class Client {
  constructor() {
    this.messages = [];
    this.events = [];
    this.states = [];
    this.welcome = null;
    this.error = null;
    this.opened = new Promise((resolve) => { this._resolveOpen = resolve; });
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.ws.onopen = () => this._resolveOpen();
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      this.messages.push(m);
      if (m.t === 'welcome') this.welcome = m;
      else if (m.t === 'err') this.error = m;
      else if (m.t === 'e') this.events.push(m);
      else if (m.t === 's') this.states.push(m);
    };
  }
  send(obj) { this.ws.send(JSON.stringify(obj)); }
  lastState() { return this.states[this.states.length - 1]; }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

async function waitFor(fn, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return true;
    await wait(50);
  }
  console.log(`  (timeout waiting for: ${label})`);
  return false;
}

async function main() {
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

  try {
    let healthy = false;
    for (let i = 0; i < 50 && !healthy; i++) {
      try { const r = await get(`${BASE}/healthz`); healthy = r.status === 200; } catch { await wait(100); }
    }
    check('server starts and /healthz responds', healthy);

    const [index, remotePage, gameJs, css, manifest] = await Promise.all([
      get(`${BASE}/`), get(`${BASE}/remote`), get(`${BASE}/game.js`),
      get(`${BASE}/style.css`), get(`${BASE}/manifest.webmanifest`),
    ]);
    check('GET / serves display page', index.status === 200 && index.body.includes('<canvas'));
    check('GET /remote serves remote page', remotePage.status === 200 && remotePage.body.includes('code-input'));
    check('GET /game.js serves renderer', gameJs.status === 200 && gameJs.body.includes('requestAnimationFrame'));
    check('GET /style.css serves styles', css.status === 200);
    check('GET /manifest.webmanifest serves manifest', manifest.status === 200);
    const traversal = await get(`${BASE}/../server.js`);
    check('path traversal blocked', traversal.status !== 200);

    const display = new Client();
    await display.opened;
    display.send({ t: 'hello', role: 'display', room: '' });
    const gotWelcome = await waitFor(() => display.welcome, 3000, 'display welcome');
    check('display gets welcome with 4-letter room code', gotWelcome && /^[A-Z0-9]{4}$/.test(display.welcome.room));
    const code = display.welcome.room;

    const badRemote = new Client();
    await badRemote.opened;
    badRemote.send({ t: 'hello', role: 'remote', room: 'ZZZZ' });
    const gotErr = await waitFor(() => badRemote.error, 3000, 'unknown room error');
    check('remote with wrong code gets error', gotErr);
    badRemote.close();

    const remote = new Client();
    await remote.opened;
    remote.send({ t: 'hello', role: 'remote', room: code });
    const remoteOk = await waitFor(() => remote.welcome, 3000, 'remote welcome');
    check('remote joins room by code', remoteOk && remote.welcome.room === code);

    remote.send({ t: 'a', a: 'start' });
    const serving = await waitFor(() => display.lastState() && display.lastState().st === 'serve', 3000, 'serve');
    check('start action begins serve phase', serving);
    const playing = await waitFor(() => display.lastState() && display.lastState().st === 'play', 4000, 'play');
    check('game enters play phase after countdown', playing);

    remote.send({ t: 'i', x: 0.05 });
    const movedLeft = await waitFor(() => {
      const s = display.lastState();
      return s && s.p < 0.2;
    }, 2000, 'paddle left');
    check('paddle moves left on remote input', movedLeft);

    remote.send({ t: 'i', x: 0.95 });
    const movedRight = await waitFor(() => {
      const s = display.lastState();
      return s && s.p > 0.8;
    }, 2000, 'paddle right');
    check('paddle moves right on remote input', movedRight);

    // autopilot: keep the paddle under the ball so it gets hit
    const auto = setInterval(() => {
      const s = remote.lastState();
      if (s && s.b) remote.send({ t: 'i', x: s.b[0] / 1920 });
    }, 33);

    const hit = await waitFor(() => remote.events.some((e) => e.k === 'paddle'), 10000, 'paddle hit');
    check('ball is hit by paddle and combo/score event fires', hit);
    const scored = await waitFor(() => {
      const s = display.lastState();
      return s && s.sc > 0 && s.cb >= 1;
    }, 3000, 'score > 0');
    check('score and combo increase after paddle hit', scored);

    const wallHit = await waitFor(() => remote.events.some((e) => e.k === 'wall' || e.k === 'top'), 5000, 'wall bounce');
    check('ball bounces off walls (wall/top events)', wallHit);

    const ballMoved = display.states.length > 10 &&
      display.states.some((s, i) => i > 5 && s.b && display.states[i - 5].b &&
        (s.b[0] !== display.states[i - 5].b[0] || s.b[1] !== display.states[i - 5].b[1]));
    check('ball position is simulated and broadcast', ballMoved);

    clearInterval(auto);
    display.close();
    remote.close();
  } finally {
    server.kill('SIGTERM');
  }

  if (failures) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll smoke checks passed.');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL: unexpected error', err);
  process.exit(1);
});
