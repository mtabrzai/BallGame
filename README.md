# Neon Bounce — Fire TV + mobile remote game

A neon arcade game for **Fire TV** where a ball bounces off the **left, top and
right walls** and you keep it alive by moving the **plate (paddle) at the
bottom** — controlled **from your mobile phone**. If the ball falls past the
bottom, you lose a life. You have 3 lives.

Two clients, one server:

| Piece | Where it runs | What it does |
|---|---|---|
| Display app (`/`) | Fire TV (Silk browser / Web App Tester, or any TV browser) | Renders the game fullscreen: glowing ball with trail, particles, screen shake, combo popups, sounds, HUD |
| Remote app (`/remote`) | Your phone (mobile browser, addable to home screen as a PWA) | Room-code join, drag track to move the plate, optional tilt control, START button, haptic feedback, live score |
| Game server (`server.js`) | Any always-on machine on your Wi-Fi (laptop, Raspberry Pi, …) | Zero-dependency Node.js. Runs the 60 fps simulation, rooms, and WebSocket relay |

## Quick start

1. On a machine on the same Wi-Fi as the TV and phone, run:

   ```bash
   node server.js          # or: npm start   (PORT=8080 by default)
   ```

   No `npm install` needed — the server has **zero dependencies** (Node 18+).

2. On the **Fire TV**, open `http://<server-ip>:8080/` in the Silk browser
   (or in Amazon's *Web App Tester* app, which lets you sideload a web page as
   a fullscreen "app"). A 4-letter **room code** appears on the screen.

3. On your **phone**, open `http://<server-ip>:8080/remote`, type the 4-letter
   code, tap **CONNECT**, then **START**. Drag on the track (or enable tilt)
   to move the plate. When the ball comes down, keep the plate under it.

4. Game over after 3 misses → press **START** on the phone to play again.

Tip: give the server machine a static IP (router DHCP reservation) so the TV
and phone URLs never change.

## Controls

- **Phone remote**: drag horizontally on the track; optional gyro tilt toggle;
  START/RESTART button.
- **Fire TV remote** (fallback, works in most browsers): `←` / `→` to move the
  plate, `Space`/`Enter` to start.

## How it works

```
 phone (/remote)                server (server.js)               Fire TV (/)
 ┌────────────┐   WS input ┌───────────────────┐   WS state   ┌────────────┐
 │ drag/tilt  │ ─────────▶ │ 60 fps simulation │ ───────────▶ │ canvas fx  │
 │ START btn  │ ─────────▶ │ rooms + scoring   │ ◀─────────── │ (arrow keys│
 └────────────┘            └───────────────────┘   WS events  └────────────┘
```

- Display connects with `role=display` → server creates a room and returns a
  4-letter code shown on the TV.
- Phone connects with `role=remote` + the code.
- The server simulates the ball on a virtual 1920×1080 field and broadcasts
  compact state frames (`{t:'s', …}`) plus one-shot events (`{t:'e', k:'paddle'|'wall'|'top'|'life'|'over'|'start'}`).
- Message protocol (JSON over WebSocket at `/ws`):

  | Direction | Message | Meaning |
  |---|---|---|
  | client → server | `{t:'hello', role:'display'\|'remote', room:'ABCD'}` | join/create room |
  | server → client | `{t:'welcome', role, room, w, h}` | joined; `room` is the code |
  | server → client | `{t:'err', msg}` | e.g. unknown room code |
  | client → server | `{t:'i', x:0..1}` | paddle target position (normalized) |
  | client → server | `{t:'a', a:'start'\|'restart'}` | start / restart the game |
  | server → client | `{t:'s', st, sc, cb, lv, b:[x,y], p, cd, best}` | state @60 Hz |
  | server → client | `{t:'e', k, …}` | event for sound/fx/haptics |

## Game rules

- Ball bounces off left, top and right walls; bottom is open.
- Each plate hit: combo +1, points `10 × combo`, ball speeds up (capped), and
  the bounce angle depends on where the ball lands on the plate (center =
  straight up, edges = sharp angles).
- Ball past the bottom: lose 1 life, combo resets, ball re-serves. 3 misses =
  game over; best score is kept.

## Fire TV notes

- The display page is overscan-friendly (playfield is letterboxed inside the
  screen edges) and scales to any TV resolution.
- For a store-like experience, sideload the URL with Amazon's **Web App
  Tester** (search it in the Fire TV Appstore). To ship as a native Fire TV
  (Android TV) APK instead, wrap the same `public/` folder in a WebView via
  Android Studio's `WebViewAssetLoader` — the game only needs WebSocket +
  canvas support.
- The remote is a PWA: on the phone, use *Add to Home Screen* for a
  fullscreen app-like remote.

## Project layout

```
server.js               game server: static files + rooms + 60 fps simulation
lib/wsmini.js           zero-dependency WebSocket (RFC 6455) implementation
public/index.html       Fire TV display page
public/game.js          display renderer: canvas, glow, particles, shake, audio
public/remote.html      mobile remote page
public/remote.js        remote logic: join, drag track, tilt, haptics
public/style.css        shared styles
public/manifest.webmanifest
test/smoke.js           end-to-end test (spawns server, simulates TV + phone)
```

## Verify

```bash
npm test     # starts the server, simulates a display + remote, plays the game
```

## Security note

Run this only on your home LAN. Do not expose the server port to the public
internet (the room codes are short and unauthenticated by design).
