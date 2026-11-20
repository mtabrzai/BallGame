'use strict';

// Neon Bounce — mobile remote client.
// Joins a room by code, then streams paddle position to the server.
// Controls: drag on the track, or tilt the phone (deviceorientation).

(() => {
  const $ = (id) => document.getElementById(id);
  const connectScreen = $('connect-screen');
  const playScreen = $('play-screen');
  const codeInput = $('code-input');
  const joinBtn = $('join-btn');
  const connError = $('conn-error');
  const track = $('track');
  const paddleInd = $('paddle-ind');
  const startBtn = $('start-btn');
  const tiltBtn = $('tilt-btn');
  const rRoom = $('r-room');
  const rScore = $('r-score');
  const rLives = $('r-lives');
  const comboLine = $('combo-line');
  const remoteStatus = $('remote-status');

  let ws = null;
  let room = null;
  let st = { st: 'lobby', sc: 0, cb: 0, lv: 3 };
  let myX = 0.5;
  let lastSent = 0;
  let tracking = false;
  let tiltOn = false;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function send(obj) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  function sendInput(x, force) {
    const now = performance.now();
    if (!force && now - lastSent < 30) return;
    lastSent = now;
    myX = clamp(x, 0, 1);
    paddleInd.style.left = (myX * 100).toFixed(2) + '%';
    send({ t: 'i', x: myX });
  }

  function connect(code) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => send({ t: 'hello', role: 'remote', room: code });
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      onMsg(m);
    };
    ws.onclose = () => {
      remoteStatus.textContent = 'Disconnected — reconnecting…';
      setTimeout(() => { if (room) connect(room); }, 1200);
    };
    ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
  }

  function onMsg(m) {
    if (m.t === 'welcome') {
      room = m.room;
      rRoom.textContent = room;
      connError.textContent = '';
      connectScreen.hidden = true;
      playScreen.hidden = false;
      history.replaceState(null, '', '/remote?room=' + room);
      sendInput(myX, true);
    } else if (m.t === 'err') {
      connError.textContent = m.msg || 'Connection error';
    } else if (m.t === 's') {
      st = m;
      rScore.textContent = String(m.sc);
      rLives.textContent = '♥'.repeat(Math.max(m.lv, 0)) || '—';
      comboLine.textContent = m.cb > 1 ? `COMBO x${m.cb}` : '';
      if (m.st === 'lobby') remoteStatus.textContent = 'Connected! Press START to play.';
      else if (m.st === 'serve') remoteStatus.textContent = 'Get ready…';
      else if (m.st === 'play') remoteStatus.textContent = 'Play! Keep the plate under the ball.';
      else if (m.st === 'over') remoteStatus.textContent = `Game over — score ${m.sc}. Press START again.`;
      startBtn.textContent = (m.st === 'play' || m.st === 'serve') ? 'RESTART' : 'START';
    } else if (m.t === 'e') {
      if (m.k === 'paddle' && navigator.vibrate) navigator.vibrate(15);
      if (m.k === 'life' && navigator.vibrate) navigator.vibrate([90, 40, 90]);
      if (m.k === 'over' && navigator.vibrate) navigator.vibrate([120, 60, 120, 60, 200]);
    }
  }

  function join() {
    const code = codeInput.value.trim().toUpperCase();
    if (code.length !== 4) {
      connError.textContent = 'Enter the 4-letter code from the TV.';
      return;
    }
    connError.textContent = 'Connecting…';
    connect(code);
  }

  joinBtn.addEventListener('click', join);
  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') join();
  });
  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  const prefill = new URLSearchParams(location.search).get('room');
  if (prefill) {
    codeInput.value = prefill.toUpperCase().slice(0, 4);
    join();
  } else {
    codeInput.focus();
  }

  // ----- drag control -----
  function moveFromEvent(e) {
    const r = track.getBoundingClientRect();
    sendInput((e.clientX - r.left) / r.width);
  }
  track.addEventListener('pointerdown', (e) => {
    tracking = true;
    track.setPointerCapture(e.pointerId);
    moveFromEvent(e);
    e.preventDefault();
  });
  track.addEventListener('pointermove', (e) => {
    if (tracking) moveFromEvent(e);
  });
  track.addEventListener('pointerup', () => { tracking = false; });
  track.addEventListener('pointercancel', () => { tracking = false; });

  // ----- tilt control -----
  async function enableTilt() {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' &&
          typeof DeviceOrientationEvent.requestPermission === 'function') {
        const res = await DeviceOrientationEvent.requestPermission();
        if (res !== 'granted') {
          tiltBtn.textContent = 'Tilt permission denied';
          return;
        }
      }
      window.addEventListener('deviceorientation', (e) => {
        if (!tiltOn || e.gamma == null) return;
        sendInput(0.5 + clamp(e.gamma, -45, 45) / 60);
      });
      tiltOn = true;
      tiltBtn.textContent = 'Tilt control: ON';
    } catch {
      tiltBtn.textContent = 'Tilt not available';
    }
  }
  tiltBtn.addEventListener('click', () => {
    if (tiltOn) {
      tiltOn = false;
      tiltBtn.textContent = 'Enable tilt control';
    } else {
      enableTilt();
    }
  });

  // ----- start / restart -----
  startBtn.addEventListener('click', () => {
    send({ t: 'a', a: st.st === 'lobby' || st.st === 'over' ? 'start' : 'restart' });
  });

  document.addEventListener('gesturestart', (e) => e.preventDefault());
})();
