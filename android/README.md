# Building the two APKs (Fire TV + phone)

The game itself is web-based (server + two web pages). These wrappers turn the
web pages into real installable `.apk` files: one for the Fire TV, one for the
phone remote. One Gradle project builds **both** via product flavors:

| Flavor | applicationId | App name | Loads |
|---|---|---|---|
| `tv` | `com.neonbounce.tv` | Neon Bounce | `http://<server-ip>:8080/` (game screen) |
| `remote` | `com.neonbounce.remote` | NB Remote | `http://<server-ip>:8080/remote` (controller) |

The server URL is **not hardcoded**: on first launch (or if the page fails to
load, or via the remote's MENU button) the app asks for the server address and
remembers it. So build once, then just type the server IP on the device.

> Note: APKs must be compiled on a machine with the Android SDK. This sandbox
> has no Java/Android SDK and cannot download one, so the binaries are not in
> this repo — only this ready-to-build source.

## Build (on any PC/Mac with Android Studio, free)

1. Install **Android Studio** (it bundles the JDK + Android SDK).
2. **File → Open** → select the `android/` folder of this repo. Let Gradle sync.
3. Edit `app/build.gradle` → flavor `tv`/`remote` → `default_url` if you want a
   different default (optional — the app asks at runtime anyway).
4. **Build → Generate Signed Bundle / APK → APK**, create/select a keystore.
5. In the variant list tick **both** `tvRelease` and `remoteRelease` → Finish.
6. APKs land in:
   - `app/build/outputs/apk/tv/release/app-tv-release.apk` — **Fire TV app**
   - `app/build/outputs/apk/remote/release/app-remote-release.apk` — **phone remote app**

## Install

**Fire TV:** enable *Settings → My Fire TV → Developer options → ADB debugging*
and *Apps from Unknown Sources*, then either:
- `adb install app/build/outputs/apk/tv/release/app-tv-release.apk`, or
- copy the APK to USB/cloud and install with a file manager app on the TV.

The app shows on the Fire TV home screen (leanback banner), landscape,
fullscreen. The Fire TV remote D-pad sends arrow keys to the page (the game
uses them as a fallback controller); MENU opens the server-URL dialog.

**Phone:** `adb install .../app-remote-release.apk`, or transfer the file and
tap it (allow "install unknown apps" for your file manager). Open **NB
Remote**, enter the server address, then the 4-letter room code from the TV.

## Requirements at runtime

- The `node server.js` host must be running and on the same Wi-Fi as both
  devices (cleartext HTTP is allowed in the manifest for this).
- `minSdk 24` covers Fire TV Stick (Fire OS 6+) and virtually all phones.
