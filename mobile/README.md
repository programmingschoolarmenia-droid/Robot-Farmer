# Android app (Capacitor)

The app is the website game inside an Android window. `copy-web.mjs` copies the game into `www/`
(with its fonts, so it works offline; without `assets/originals/` and the MP3 copy of the music, which
the app never loads) and never changes the game files. `www/` is not in git.

## Test build (every push that changes `mobile/`)

GitHub's **Android** workflow builds a test APK (local accounts, no live keys) and plays it on an
Android emulator with `android-test.mjs`: login, a program, the Code tab, the keyboard, turning the
phone, the Back key and a start without internet. The report, screenshots and APK are in the run's
`android-report` download.

## A new version for Google Play

1. **One time: the upload key.** On your computer (Java is installed):
   ```
   keytool -genkeypair -v -keystore upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
   base64 -i upload.jks | pbcopy
   ```
   Keep `upload.jks` and its passwords somewhere safe, outside this folder. If you lose them,
   Google has to reset the key. In GitHub → Settings → Secrets and variables → Actions, add:
   - `ANDROID_KEYSTORE_BASE64`: what `pbcopy` copied
   - `ANDROID_KEYSTORE_PASSWORD` and `ANDROID_KEY_PASSWORD`: the passwords you typed
   - `ANDROID_KEY_ALIAS`: `upload`
2. **Each release:** GitHub → Actions → **Android release** → Run workflow. It copies the current
   game (`npm run sync` = `npm run web` + `cap sync`), sets the version number to the run number
   (each upload needs a higher one), and signs the AAB. Download `bridgys-farm-aab` and upload
   `app-release.aab` in the Play Console.
3. **Before the first release, try it on a phone:** log in with a real account. The app talks to
   Firebase from `https://localhost`, so if the Firebase API key is restricted to the website's
   address in Google Cloud, logins in the app fail until that address is allowed too.

To build on your own computer instead (needs Android Studio): `npm run sync`, then open
`android/` in Android Studio. Run `npm run sync` before every build, or the app ships an old
copy of the game.

## Play Console pieces

- App icon 512×512: `store/icon-512.png`. Feature graphic 1024×500: `store/feature-1024x500.png`.
- Phone screenshots (portrait): take them in the app.
- **Your paperwork in the Play Console:**
  - a privacy policy page (its web address)
  - the Data safety form: usernames, passwords and farms go to Firebase; nothing is sold or shared
  - the content rating questionnaire
  - Target audience: ages 9–17, which brings the Families policy rules
