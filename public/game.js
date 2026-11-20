'use strict';

// Neon Bounce — Fire TV display client.
// Connects to the server as the "display" of a room, renders the game state
// on a fullscreen canvas with neon effects, and also accepts Fire TV remote
// (arrow keys / space) input as a fallback controller.

(() => {
  const W = 1920;
  const H = 1080;
  const PADDLE_W = 280;
  const PADDLE_H = 28;
  const PADDLE_Y = H - 100;
  const BALL_R = 16;

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const statusEl = document.getElementById('status');

  let vw = 0;
  let vh = 0;
  let view = { s: 1, ox: 0, oy: 0 };

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    vw = canvas.width = Math.round(window.innerWidth * dpr);
    vh = canvas.height = Math.round(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    const s = Math.min(vw / W, vh / H);
    view = { s, ox: (vw - W * s) / 2, oy: (vh - H * s) / 2 };
  }
  window.addEventListener('resize', resize);
  resize();

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function px(roomP) { return PADDLE_W / 2 + roomP * (W - PADDLE_W); }

  // ----- state -----
  let st = { st: 'lobby', sc: 0, cb: 0, lv: 3, b: null, p: 0.5, cd: 0, best: 0 };
  let cur = { bx: W / 2, by: H * 0.4, p: 0.5 };
  let trail = [];
  const particles = [];
  const popups = [];
  const stars = Array.from({ length: 150 }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    r: 0.6 + Math.random() * 2,
    ph: Math.random() * Math.PI * 2,
    sp: 0.6 + Math.random() * 1.8,
  }));
  let shake = 0;
  let flash = 0;
  let squash = 0;
  let demo = { x: W / 2, y: H / 2, vx: 420, vy: -340 };
  let roomCode = new URLSearchParams(location.search).get('room') || '';

  // ----- audio -----
  let AC = null;
  function audio() {
    if (!AC) {
      try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch { AC = null; }
    }
    if (AC && AC.state === 'suspended') AC.resume();
    return AC;
  }
  function beep(freq, dur, type, vol, slide) {
    const ac = audio();
    if (!ac) return;
    const t = ac.currentTime;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol || 0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(ac.destination);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  window.addEventListener('pointerdown', audio);
  window.addEventListener('keydown', audio);

  // ----- websocket -----
  let ws = null;
  function setStatus(text) {
    if (!text) { statusEl.hidden = true; return; }
    statusEl.textContent = text;
    statusEl.hidden = false;
  }
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: 'hello', role: 'display', room: roomCode }));
    };
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      onMsg(m);
    };
    ws.onclose = () => {
      setStatus('Reconnecting…');
      setTimeout(connect, 1000);
    };
    ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
  }

  function send(obj) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  function onMsg(m) {
    if (m.t === 'welcome') {
      roomCode = m.room;
      history.replaceState(null, '', '?room=' + roomCode);
      setStatus('');
      audio();
    } else if (m.t === 's') {
      st = m;
      localTarget = m.p;
    } else if (m.t === 'e') {
      onEvent(m);
    }
  }

  function burst(x, y, n, color) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 120 + Math.random() * 460;
      particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.45 + Math.random() * 0.5,
        age: 0,
        r: 2 + Math.random() * 4,
        color,
      });
    }
  }

  function popup(x, y, text, color) {
    popups.push({ x, y, text, color, age: 0, life: 1.1 });
  }

  function onEvent(m) {
    const x = typeof m.x === 'number' ? m.x : cur.bx;
    const y = typeof m.y === 'number' ? m.y : cur.by;
    if (m.k === 'paddle') {
      const hue = 190 + Math.min(m.cb || 1, 20) * 9;
      burst(x, y, 30, `hsl(${hue} 100% 65%)`);
      shake = Math.min(shake + 5, 12);
      squash = 1;
      popup(x, PADDLE_Y - 70, `+${m.pts}`, `hsl(${hue} 100% 70%)`);
      beep(280 + Math.min(m.cb || 1, 24) * 28, 0.09, 'square', 0.12, 140);
      if (navigator.vibrate) { /* TV: no-op */ }
    } else if (m.k === 'wall' || m.k === 'top') {
      burst(x, y, 12, '#67e8f9');
      shake = Math.min(shake + 2, 8);
      beep(196, 0.06, 'triangle', 0.1, -50);
    } else if (m.k === 'life') {
      flash = 0.55;
      shake = 22;
      popup(W / 2, H / 2 - 100, 'MISS!', '#fb7185');
      beep(130, 0.4, 'sawtooth', 0.16, -80);
    } else if (m.k === 'over') {
      beep(240, 0.6, 'sawtooth', 0.15, -190);
    } else if (m.k === 'start') {
      beep(440, 0.12, 'square', 0.12, 240);
    }
  }

  // ----- keyboard (Fire TV remote D-pad / testing) -----
  let localTarget = 0.5;
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      localTarget = clamp(localTarget + (e.key === 'ArrowRight' ? 0.035 : -0.035), 0, 1);
      send({ t: 'i', x: localTarget });
    } else if (e.key === ' ' || e.key === 'Enter') {
      send({ t: 'a', a: 'start' });
      e.preventDefault();
    }
  });

  // ----- drawing helpers -----
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawBackground(t) {
    const g = ctx.createRadialGradient(vw / 2, vh * 0.35, 60, vw / 2, vh / 2, Math.max(vw, vh) * 0.75);
    g.addColorStop(0, '#0d1030');
    g.addColorStop(0.55, '#070418');
    g.addColorStop(1, '#030109');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, vw, vh);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of stars) {
      const a = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t * s.sp + s.ph));
      ctx.fillStyle = `rgba(180, 220, 255, ${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(view.ox + s.x * view.s, view.oy + s.y * view.s, s.r * view.s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawWalls() {
    const { s, ox, oy } = view;
    const x0 = ox, y0 = oy, x1 = ox + W * s, y1 = oy + H * s;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.shadowBlur = 26 * s;
    ctx.lineWidth = 6 * s;
    const grad = ctx.createLinearGradient(x0, y0, x1, y1);
    grad.addColorStop(0, '#22d3ee');
    grad.addColorStop(0.5, '#818cf8');
    grad.addColorStop(1, '#e879f9');
    ctx.strokeStyle = grad;
    ctx.shadowColor = '#22d3ee';
    ctx.beginPath();
    ctx.moveTo(x0, y1);
    ctx.lineTo(x0, y0);
    ctx.lineTo(x1, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.restore();
  }

  function drawPaddle() {
    const { s, ox, oy } = view;
    const cx = ox + px(cur.p) * s;
    const cy = oy + PADDLE_Y * s;
    const w = PADDLE_W * s;
    const h = PADDLE_H * s * (1 - 0.4 * squash);
    ctx.save();
    ctx.shadowBlur = 34 * s;
    ctx.shadowColor = '#e879f9';
    const g = ctx.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
    g.addColorStop(0, '#e879f9');
    g.addColorStop(0.5, '#f0abfc');
    g.addColorStop(1, '#22d3ee');
    ctx.fillStyle = g;
    rr(cx - w / 2, cy - h / 2, w, h, h / 2);
    ctx.fill();
    ctx.restore();
  }

  function ballColor() {
    const hue = 190 + Math.min(st.cb, 20) * 9;
    return `hsl(${hue} 100% 62%)`;
  }

  function drawBall() {
    const { s, ox, oy } = view;
    const bx = ox + cur.bx * s;
    const by = oy + cur.by * s;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < trail.length; i++) {
      const p = trail[i];
      const a = (i / trail.length) * 0.35;
      ctx.fillStyle = ballColor().replace('62%)', `62% / ${a.toFixed(3)})`).replace('hsl(', 'hsla(');
      ctx.beginPath();
      ctx.arc(ox + p.x * s, oy + p.y * s, BALL_R * s * (0.35 + 0.65 * (i / trail.length)), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.save();
    ctx.shadowBlur = 40 * s;
    ctx.shadowColor = ballColor();
    ctx.fillStyle = ballColor();
    ctx.beginPath();
    ctx.arc(bx, by, BALL_R * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(bx - BALL_R * s * 0.3, by - BALL_R * s * 0.3, BALL_R * s * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawParticles(dt) {
    const { s, ox, oy } = view;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += dt;
      if (p.age >= p.life) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 500 * dt;
      const a = 1 - p.age / p.life;
      ctx.fillStyle = p.color.replace('65%)', `65% / ${a.toFixed(3)})`).replace('hsl(', 'hsla(');
      ctx.beginPath();
      ctx.arc(ox + p.x * s, oy + p.y * s, p.r * s * a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawPopups(dt) {
    const { s, ox, oy } = view;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `900 ${54 * s}px system-ui, sans-serif`;
    for (let i = popups.length - 1; i >= 0; i--) {
      const p = popups[i];
      p.age += dt;
      if (p.age >= p.life) { popups.splice(i, 1); continue; }
      const a = 1 - p.age / p.life;
      ctx.globalAlpha = a;
      ctx.shadowBlur = 20 * s;
      ctx.shadowColor = p.color;
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, ox + p.x * s, oy + (p.y - p.age * 90) * s);
    }
    ctx.restore();
  }

  function drawHud() {
    const { s, ox, oy } = view;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#67e8f9';
    ctx.font = `700 ${30 * s}px system-ui, sans-serif`;
    ctx.globalAlpha = 0.9;
    ctx.fillText('ROOM  ' + roomCode, ox + W * s / 2, oy + 52 * s);
    ctx.textAlign = 'left';
    ctx.font = `800 ${64 * s}px system-ui, sans-serif`;
    ctx.shadowBlur = 18 * s;
    ctx.shadowColor = '#22d3ee';
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(String(st.sc), ox + 40 * s, oy + 110 * s);
    ctx.font = `600 ${26 * s}px system-ui, sans-serif`;
    ctx.fillStyle = '#94a3b8';
    ctx.shadowBlur = 0;
    ctx.fillText('SCORE' + (st.best ? `   ·   BEST ${st.best}` : ''), ox + 42 * s, oy + 142 * s);
    if (st.cb > 1) {
      ctx.textAlign = 'center';
      ctx.font = `900 ${44 * s}px system-ui, sans-serif`;
      ctx.fillStyle = '#e879f9';
      ctx.shadowBlur = 16 * s;
      ctx.shadowColor = '#e879f9';
      ctx.fillText(`COMBO x${st.cb}`, ox + W * s / 2, oy + 190 * s);
    }
    ctx.textAlign = 'right';
    ctx.font = `${46 * s}px system-ui, sans-serif`;
    ctx.shadowBlur = 14 * s;
    ctx.shadowColor = '#fb7185';
    ctx.fillStyle = '#fb7185';
    ctx.fillText('♥'.repeat(Math.max(st.lv, 0)), ox + W * s - 40 * s, oy + 104 * s);
    ctx.restore();
  }

  function drawCenterText(lines) {
    const { s, ox, oy } = view;
    ctx.save();
    ctx.textAlign = 'center';
    let y = oy + H * s * 0.42;
    for (const line of lines) {
      ctx.font = `${line.w * s}px ${line.weight || 800}, system-ui, sans-serif`;
      ctx.shadowBlur = (line.glow || 30) * s;
      ctx.shadowColor = line.color;
      ctx.fillStyle = line.color;
      ctx.globalAlpha = line.alpha == null ? 1 : line.alpha;
      ctx.fillText(line.text, ox + W * s / 2, y);
      y += line.gap * s;
    }
    ctx.restore();
  }

  function drawLobby(t) {
    const pulse = 0.75 + 0.25 * Math.sin(t * 3);
    drawCenterText([
      { text: 'NEON BOUNCE', w: 110, color: '#e879f9', glow: 40, gap: 150 },
      { text: 'ROOM CODE', w: 40, color: '#94a3b8', weight: 700, gap: 110, alpha: 0.9 },
      { text: roomCode || '····', w: 190, color: '#22d3ee', glow: 60, gap: 120, alpha: pulse },
      { text: `On your phone open  ${location.host}/remote  and enter the code`, w: 34, color: '#cbd5e1', weight: 600, gap: 80, alpha: 0.95 },
      { text: 'Press START on your phone to play', w: 30, color: '#64748b', weight: 600, gap: 60, alpha: 0.6 + 0.4 * Math.sin(t * 4) },
    ]);
  }

  function drawGameOver() {
    ctx.save();
    ctx.fillStyle = 'rgba(3, 1, 9, 0.72)';
    ctx.fillRect(0, 0, vw, vh);
    ctx.restore();
    drawCenterText([
      { text: 'GAME OVER', w: 120, color: '#fb7185', glow: 44, gap: 130 },
      { text: `SCORE ${st.sc}`, w: 64, color: '#22d3ee', glow: 30, gap: 80 },
      { text: `BEST ${st.best}`, w: 36, color: '#94a3b8', weight: 700, gap: 90 },
      { text: 'Press START on your phone (or Space) to play again', w: 32, color: '#cbd5e1', weight: 600 },
    ]);
  }

  // ----- main loop -----
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now / 1000;

    const k = Math.min(1, dt * 20);
    cur.p += (st.p - cur.p) * k;
    if (st.b) {
      cur.bx += (st.b[0] - cur.bx) * k;
      cur.by += (st.b[1] - cur.by) * k;
      trail.push({ x: cur.bx, y: cur.by });
      if (trail.length > 18) trail.shift();
    } else {
      // attract mode in lobby: bounce a demo ball off the three walls
      demo.x += demo.vx * dt;
      demo.y += demo.vy * dt;
      if (demo.x < BALL_R) { demo.x = BALL_R; demo.vx = Math.abs(demo.vx); }
      if (demo.x > W - BALL_R) { demo.x = W - BALL_R; demo.vx = -Math.abs(demo.vx); }
      if (demo.y < BALL_R) { demo.y = BALL_R; demo.vy = Math.abs(demo.vy); }
      if (demo.y > H - 40) { demo.y = H - 40; demo.vy = -Math.abs(demo.vy); }
      cur.bx = demo.x;
      cur.by = demo.y;
      trail.push({ x: cur.bx, y: cur.by });
      if (trail.length > 18) trail.shift();
    }

    shake *= Math.pow(0.0005, dt);
    if (shake < 0.1) shake = 0;
    flash = Math.max(0, flash - dt * 1.6);
    squash *= Math.pow(0.001, dt);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawBackground(t);

    ctx.save();
    if (shake > 0) {
      const m = shake * view.s * 0.6;
      ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
    }
    drawWalls();
    drawParticles(dt);
    drawBall();
    if (st.st !== 'lobby') drawPaddle();
    drawPopups(dt);
    ctx.restore();

    if (st.st === 'lobby') {
      drawLobby(t);
    } else {
      drawHud();
      if (st.st === 'serve' && st.cd > 0) {
        drawCenterText([{ text: st.cd > 0.7 ? 'READY' : 'GO!', w: 130, color: '#22d3ee', glow: 50, gap: 0 }]);
      }
      if (st.st === 'over') drawGameOver();
    }

    if (flash > 0) {
      ctx.fillStyle = `rgba(251, 113, 133, ${(flash * 0.5).toFixed(3)})`;
      ctx.fillRect(0, 0, vw, vh);
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  connect();
})();
