# CISE Student Records

Android app for the Primary Division Director to securely manage student
records and guardian/emergency contact information.

**App ID:** `et.cise.studentrecords`
**Stack:** React + Vite + Tailwind CSS + Capacitor, encrypted SQLite
(SQLCipher via `@capacitor-community/sqlite`), role-based access, audit log.

## Getting the APK from a tablet (no laptop needed)

This project includes an automated build file
(`.github/workflows/build-apk.yml`) that lets GitHub build the APK for you
in the cloud. Steps, all doable from a tablet browser:

1. Create a free account at github.com if you don't have one.
2. Create a new repository (e.g. "cise-student-records").
3. Unzip this project on your tablet, then upload all the files/folders to
   that repository using GitHub's "Add file > Upload files" button (drag
   the extracted folder contents in, or upload as a zip and GitHub will let
   you browse it — if it only accepts individual files, upload folder by
   folder).
4. Once uploaded, click the **Actions** tab at the top of the repository.
   You should see a build running automatically (it takes 3-5 minutes).
5. When it finishes (green checkmark), click into that run, scroll to
   **Artifacts**, and download `cise-student-records-apk`. This is a zip
   containing the installable `app-debug.apk` file.
6. On your Android tablet, open the downloaded APK file. If prompted,
   allow "install from unknown sources" for your browser/file app — this
   is normal for apps installed outside the Play Store.
7. Open the app. Log in with `director` / `0000`, then immediately go to
   Settings and change the PIN.

Note: this builds a **debug APK**, meant for internal use on your own
devices. It's not signed for the Play Store, which is fine for a
school-internal tool but worth knowing.

## What's included

- PIN-based login with per-user salted hash (PBKDF2) — no plaintext PINs
  stored anywhere
- Two roles: **Director** (full access, manages teacher accounts, sees audit
  log) and **Teacher** (only sees students in their assigned class)
- Student records: name, DOB, gender, grade/class, guardian contact,
  emergency contact, medical notes, address
- Search and CSV export
- Soft-delete only ("Archive") — nothing is destructively deleted
- Full audit log: every login, failed login, view, create, edit, archive,
  and export is timestamped and attributed to a user
- Auto-lock after 3 minutes of inactivity, requiring the PIN to resume
- Basic brute-force protection: 5 failed attempts triggers a 60s lockout
- On-device data is encrypted at rest via SQLCipher (native Android build).
  The web preview build (for quick testing in a browser) uses an
  AES-encrypted local fallback — **that fallback is for development only,
  never for real student data.**

## Before you ship (important)

1. **Set a real encryption secret.** Copy `.env.example` to `.env` and set
   `VITE_DB_SECRET` to a long random string. Better yet, wire this to the
   Android Keystore instead of a build-time env var — a determined attacker
   with the APK can extract a hardcoded secret. This scaffold uses an env
   var to keep the first build simple; hardening the secret storage is the
   one item you shouldn't skip before real student data goes on the device.
2. **Change the default director PIN** (`director` / `0000`) the first time
   you log in, under Settings > Change PIN.
3. Decide a **data retention policy** (how long to keep records after a
   student leaves) — archiving is built in, but purging old archives is a
   policy decision, not a technical one.
4. If multiple devices need to share data, this scaffold is single-device
   local storage only — ask if you want a sync layer added later.

## Local development

```bash
npm install
npm run dev
```

This runs in the browser using the encrypted local-storage fallback so you
can test the UI without a device. Default login: `director` / `0000`.

## Building the Android APK

You'll need Android Studio with the Android SDK installed (this can't be
done on a tablet — same limitation as the My Library app).

```bash
npm install
npm run build
npx cap add android      # first time only
npx cap sync android
npx cap open android
```

This opens Android Studio. From there: **Build > Build Bundle(s) / APK(s) >
Build APK(s)**. The signed APK will be in
`android/app/build/outputs/apk/`.

To install directly to a connected device instead:

```bash
npx cap run android
```

## Project structure

```
src/
  auth/          PIN hashing, session/auth context (login, lock, logout)
  db/            SQLite (native) + encrypted fallback (web), schema, CRUD
  pages/         Login, Lock screen, Student list/form/detail, Audit log, Settings
  components/    App shell/navigation
  utils/         CSV export
```
