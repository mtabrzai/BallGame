'use strict';

// Neon Bounce — server-authoritative game server.
// Serves the Fire TV display page (/) and the mobile remote page (/remote),
// and runs the game simulation at 60 ticks/s, broadcasting state to both.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const wsmini = require('./lib/wsmini');

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');

// Virtual playfield. Clients scale this to any screen size.
const W = 1920;
const H = 1080;
const PADDLE_W = 280;
const PADDLE_H = 28;
const PADDLE_Y = H - 100;
const BALL_R = 16;
const TICK_MS = 1000 / 60;
const ROOM_TTL_MS = 5 * 60 * 1000;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  else if (!path.extname(p)) p += '.html';
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
});

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

const rooms = new Map();

function paddleX(room) {
  return PADDLE_W / 2 + room.paddle * (W - PADDLE_W);
}

function createRoom(code) {
  if (!code) {
    do {
      code = Array.from({ length: 4 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
    } while (rooms.has(code));
  }
  const room = {
    code,
    display: null,
    remotes: new Set(),
    target: 0.5,
    paddle: 0.5,
    ball: null,
    score: 0,
    combo: 0,
    lives: 3,
    status: 'lobby',
    countdown: 0,
    best: 0,
    deadAt: 0,
  };
  rooms.set(code, room);
  return room;
}

function startGame(room) {
  room.score = 0;
  room.combo = 0;
  room.lives = 3;
  room.status = 'serve';
  room.countdown = 1.4;
  room.ball = { x: paddleX(room), y: PADDLE_Y - BALL_R - 2, vx: 0, vy: 0 };
  sendEvent(room, 'start');
}

function launch(room) {
  const angle = -Math.PI / 2 + (Math.random() * 1.0 - 0.5);
  const speed = 560;
  room.ball.vx = Math.cos(angle) * speed;
  room.ball.vy = Math.sin(angle) * speed;
  room.status = 'play';
}

function step(room, dt) {
  room.paddle += (clamp(room.target, 0, 1) - room.paddle) * Math.min(1, 16 * dt);

  if (room.status === 'serve') {
    room.countdown -= dt;
    if (room.ball) room.ball.x = paddleX(room);
    if (room.countdown <= 0) launch(room);
    return;
  }
  if (room.status !== 'play' || !room.ball) return;

  const b = room.ball;
  b.x += b.vx * dt;
  b.y += b.vy * dt;

  if (b.x - BALL_R < 0) {
    b.x = BALL_R;
    b.vx = Math.abs(b.vx);
    sendEvent(room, 'wall', { x: b.x, y: b.y });
  }
  if (b.x + BALL_R > W) {
    b.x = W - BALL_R;
    b.vx = -Math.abs(b.vx);
    sendEvent(room, 'wall', { x: b.x, y: b.y });
  }
  if (b.y - BALL_R < 0) {
    b.y = BALL_R;
    b.vy = Math.abs(b.vy);
    sendEvent(room, 'top', { x: b.x, y: b.y });
  }

  const px = paddleX(room);
  if (
    b.vy > 0 &&
    b.y + BALL_R >= PADDLE_Y &&
    b.y - BALL_R <= PADDLE_Y + PADDLE_H &&
    Math.abs(b.x - px) <= PADDLE_W / 2 + BALL_R
  ) {
    const off = clamp((b.x - px) / (PADDLE_W / 2), -1, 1);
    const speed = Math.min(Math.hypot(b.vx, b.vy) * 1.055, 1700);
    const angle = -Math.PI / 2 + off * (Math.PI / 3);
    b.vx = Math.cos(angle) * speed;
    b.vy = Math.sin(angle) * speed;
    b.y = PADDLE_Y - BALL_R - 0.5;
    room.combo += 1;
    const pts = 10 * room.combo;
    room.score += pts;
    sendEvent(room, 'paddle', { x: b.x, y: b.y, cb: room.combo, pts });
  }

  if (b.y - BALL_R > H) {
    room.lives -= 1;
    room.combo = 0;
    sendEvent(room, 'life', { x: b.x, y: H - 40 });
    if (room.lives <= 0) {
      room.status = 'over';
      room.ball = null;
      if (room.score > room.best) room.best = room.score;
      sendEvent(room, 'over', { score: room.score, best: room.best });
    } else {
      room.status = 'serve';
      room.countdown = 1.4;
      room.ball = { x: px, y: PADDLE_Y - BALL_R - 2, vx: 0, vy: 0 };
    }
  }
}

function stateMsg(room) {
  return JSON.stringify({
    t: 's',
    st: room.status,
    sc: room.score,
    cb: room.combo,
    lv: room.lives,
    b: room.ball ? [Math.round(room.ball.x), Math.round(room.ball.y)] : null,
    p: Number(room.paddle.toFixed(4)),
    cd: Number(room.countdown.toFixed(2)),
    best: room.best,
  });
}

function sendTo(room, msg) {
  if (room.display && !room.display.closed) room.display.send(msg);
  for (const r of room.remotes) {
    if (!r.closed) r.send(msg);
  }
}

function sendEvent(room, k, data) {
  sendTo(room, JSON.stringify({ t: 'e', k, ...(data || {}) }));
}

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    step(room, TICK_MS / 1000);
    sendTo(room, stateMsg(room));
    if (!room.display && room.remotes.size === 0 && room.deadAt && now - room.deadAt > ROOM_TTL_MS) {
      rooms.delete(code);
    }
  }
}, TICK_MS);

wsmini.attach(server, (conn) => {
  let room = null;
  let role = null;

  conn.on('message', (raw) => {
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }

    if (m.t === 'hello') {
      role = m.role;
      const code = String(m.room || '').toUpperCase();
      if (role === 'display') {
        room = (code && rooms.get(code)) || createRoom(code || null);
        if (room.display && room.display !== conn) {
          try { room.display.close(); } catch { /* ignore */ }
        }
        room.display = conn;
        room.deadAt = 0;
        conn.send(JSON.stringify({ t: 'welcome', role: 'display', room: room.code, w: W, h: H }));
      } else if (role === 'remote') {
        room = rooms.get(code);
        if (!room) {
          conn.send(JSON.stringify({ t: 'err', msg: 'Room not found. Check the 4-letter code on the TV.' }));
          return;
        }
        room.remotes.add(conn);
        conn.send(JSON.stringify({ t: 'welcome', role: 'remote', room: room.code, w: W, h: H }));
      }
      return;
    }

    if (!room) return;
    if (m.t === 'i' && typeof m.x === 'number' && Number.isFinite(m.x)) {
      room.target = clamp(m.x, 0, 1);
    } else if (m.t === 'a' && typeof m.a === 'string') {
      if (m.a === 'start' && (room.status === 'lobby' || room.status === 'over')) startGame(room);
      else if (m.a === 'restart' && room.status !== 'lobby') startGame(room);
    }
  });

  conn.on('close', () => {
    if (!room) return;
    if (room.display === conn) {
      room.display = null;
      room.deadAt = Date.now();
    }
    room.remotes.delete(conn);
    if (!room.display && room.remotes.size === 0) room.deadAt = Date.now();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Neon Bounce running.`);
  console.log(`  Fire TV display : http://localhost:${PORT}/`);
  console.log(`  Mobile remote   : http://localhost:${PORT}/remote`);
  console.log(`  On your LAN     : replace localhost with this machine's IP, e.g. http://192.168.1.10:${PORT}/`);
});
