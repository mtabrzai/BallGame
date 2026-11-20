# Building the native APKs (optional)

The game is web-based, so normally you don't need an APK: open the server URL in
the Fire TV's Silk browser or in Amazon's **Web App Tester**, and "Add to Home
Screen" on the phone for the remote. Use this wrapper only if you want a real,
installable `.apk`.

This sandbox cannot compile APKs (no Android SDK), so build it on your machine:

## TV app APK (Android TV / Fire TV)

1. Install **Android Studio** (with the Android SDK).
2. Open the `android/` folder of this repo as a project.
3. Edit `app/src/main/res/values/strings.xml` → set `game_url` to your server,
   e.g. `http://192.168.1.10:8080/`.
4. **Build → Generate Signed Bundle / APK → APK** (create a keystore the first
   time). The APK lands in `app/build/outputs/apk/release/`.
5. Install on the Fire TV:
   - `adb install app/build/outputs/apk/release/app-release.apk` (enable ADB
     debugging on the Fire TV: Settings → My Fire TV → Developer options), or
   - copy the APK to a USB stick / cloud drive and install with a file manager
     app on the TV (enable "install unknown apps" for it).
6. The app appears on the Fire TV home screen (leanback banner included) and
   loads the game fullscreen. The Fire TV remote D-pad sends arrow keys to the
   page, which the game uses as a fallback controller.

## Phone remote APK

Same template, different URL: copy the `android/` folder, change
`applicationId` to e.g. `com.neonbounce.remote`, `app_name` to "NB Remote", and
`game_url` to `http://192.168.1.10:8080/remote`. Build and install on the phone
the same way. (Or just use the browser + "Add to Home Screen" — same result.)

## Notes

- The manifest sets `usesCleartextTraffic="true"` so the app can reach the
  `http://` server on your LAN.
- `minSdk 24` covers Fire TV Stick (Fire OS 6+) and most phones.
- The server must be running and reachable from the device (same Wi-Fi).
