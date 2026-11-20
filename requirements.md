# Neon Bounce — Requirements

A two-app ball game: the game screen runs on a **Fire TV**, the controller runs
on a **mobile phone**, and both connect to each other **over Wi-Fi**.

## Functional requirements

### FR-1 — Fire TV game screen (App 1)
- FR-1.1 The game is displayed fullscreen on the Fire TV.
- FR-1.2 A ball moves on screen and bounces off the **left, top and right walls**.
- FR-1.3 A **plate (paddle) at the bottom** of the screen can move left and right.
- FR-1.4 If the ball falls past the bottom edge, the ball is **out** (a life is lost).
- FR-1.5 The player can keep the plate under the ball so the ball **hits the plate and reflects back**.
- FR-1.6 The game is **visually appealing with good visual effects** for TV:
  neon glow, ball trail, particle bursts, screen shake, combo popups, sound
  effects, animated lobby / countdown / game-over screens.
- FR-1.7 The TV screen shows a **4-letter room code** so the phone can pair.
- FR-1.8 Scoring: points per plate hit with a **combo multiplier**; ball speeds
  up on each hit; **3 lives**; best score is remembered; game over after 3
  misses, restartable from the phone.
- FR-1.9 The Fire TV remote D-pad also works as a fallback controller
  (arrow keys move the plate, Space starts).

### FR-2 — Mobile remote (App 2)
- FR-2.1 The mobile app connects to the Fire TV game **over Wi-Fi** by entering
  the 4-letter room code shown on the TV.
- FR-2.2 **Moving/dragging left on the phone moves the plate left on the TV;
  moving right moves it right** (1:1 horizontal control).
- FR-2.3 Optional **tilt (gyro) control** on the phone.
- FR-2.4 **START / RESTART** button on the phone.
- FR-2.5 Live status on the phone: score, lives, combo, game state.
- FR-2.6 Haptic (vibration) feedback on the phone when the ball hits the plate
  or is missed.

### FR-3 — Connectivity / platform
- FR-3.1 Both apps connect through a small game server on the same Wi-Fi
  (WebSocket). No internet or cloud service required.
- FR-3.2 Each app must be deliverable as a **web page** (playable in a browser /
  PWA) **and as an installable APK** (Android TV wrapper for the Fire TV,
  Android wrapper for the phone).

## Non-functional requirements

- NFR-1 Zero-dependency server (Node.js ≥ 18, no `npm install` needed).
- NFR-2 Game simulation runs server-side at 60 fps; clients only render /
  send input, so control latency is low and cheating is limited.
- NFR-3 Display scales to any TV resolution and is overscan-safe.
- NFR-4 LAN-only by default; the server must not be exposed to the public
  internet (room codes are short and unauthenticated by design).
- NFR-5 End-to-end automated test (`node test/smoke.js`) simulating a TV and a
  phone over real WebSockets.

## Architecture

```
 phone (/remote or remote APK)          server (server.js)            Fire TV (/ or tv APK)
 ┌──────────────┐   WS input ┌────────────────────┐   WS state    ┌──────────────┐
 │ drag / tilt  │ ─────────▶ │ 60 fps simulation  │ ────────────▶ │ canvas fx    │
 │ START button │ ─────────▶ │ rooms + scoring    │ ◀──────────── │ D-pad keys   │
 └──────────────┘            └────────────────────┘   WS events   └──────────────┘
```

## Delivery status

- Web apps + server + tests: implemented and verified (`test/smoke.js`, 18/18).
- APKs: wrapper source in `android/` (flavors `tv` + `remote`, one build
  produces both APKs). The `.apk` binaries must be compiled on a machine with
  Android Studio — the build sandbox has no Java/Android SDK.

## How to run (web)

```bash
node server.js
# Fire TV:  http://<server-ip>:8080/
# Phone:    http://<server-ip>:8080/remote   → enter the TV's 4-letter code
```
