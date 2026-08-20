# MissionControl Android — Phase 1 verification

Plan: `docs/superpowers/plans/2026-08-20-android-phase-1.md`
Spec: `docs/superpowers/specs/2026-08-20-android-app-design.md`

## Automated evidence (recorded 2026-08-20)

| Check | Result |
| --- | --- |
| `npm test` — core | 270 passed |
| `npm test` — server | 144 passed |
| `npm test` — client | 318 passed |
| Baseline before the work started | 607 passed (341 server, 266 client) |
| `tsc --noEmit` across core, server, client | clean |
| `core/test/nodeFree.test.ts` (no `node:` import reaches core) | passing |
| `npm run build` (all three workspaces) | succeeds |
| `./gradlew assembleDebug` | BUILD SUCCESSFUL, `app-debug.apk` produced |
| Desktop web bundle | 1038 kB |
| Android web bundle (`MC_TARGET=android`) | 821 kB — Confluence, Case Library, Traceability, Time Spent, Team, Incidents, Boards, Dashboards, Reports and Lumo chunks dropped |

Toolchain used: Android Studio's bundled JDK 21, Android SDK platform 36,
build-tools 37.0.0, Capacitor 8.5.0.

## Emulator evidence (recorded 2026-08-20, API 34 emulator, WebView 113)

The APK was installed and launched on an emulator and inspected over the
WebView debugging protocol. What this establishes:

| Check | Evidence |
| --- | --- |
| App launches, no crash | `MainActivity` resumed and focused; no `AndroidRuntime` entry in logcat |
| All native plugins register | logcat lists CapacitorHttp, BiometricAuthNative, SecureStoragePlugin, Filesystem, Preferences, App |
| Boot order is correct | logcat shows biometry check → Preferences/Filesystem hydrate → credentials read → app listeners, in that order |
| First-run absence of caches is survivable | `kv-issueCache.json` and `kv-trCache.json` reads fail with OS-PLUG-FILE-0008 and hydration continues |
| Biometric gate degrades safely | emulator reports `biometryNotEnrolled` and `deviceIsSecure: false`; the app opens rather than locking the user out |
| React mounts and the UI renders | `#root` has 1592 bytes of markup; visible text is the login form |
| No horizontal overflow | `document.documentElement.scrollWidth === innerWidth` (412); the login card measures 380px |
| **The gateway is reachable and CORS is bypassed** | `fetch('https://hp-jira.external.hp.com/rest/api/2/myself')` from inside the WebView returns **HTTP 401**. A browser-origin fetch would have thrown a CORS `TypeError`; a readable status proves the request went through native OkHttp. 401 rather than a SAML redirect also confirms the gateway expects a token on REST. |
| **The in-process dispatcher is serving `/api`** | An HTTP `fetch('/api/auth/status')` returns `index.html`, not JSON. The app nonetheless reached a clean login screen, which is only possible if the dispatcher answered the call. |

Note: `adb exec-out screencap` returns a blank or partial frame for this
WebView on this emulator. The DOM inspection above is the reliable signal;
do not read a white screenshot as a blank app.

What the emulator cannot establish: anything requiring real credentials, a
real fingerprint, or cellular. Those are the device checklist below.

## Device checklist — NOT YET RUN

Every item below needs a physical Android device, real Jira and TestRail
credentials, and **VPN off, on cellular** — that last condition is the whole
point, since it proves the app reaches the HP external gateway without any
corporate network.

Build a release-signed APK first:

```bash
keytool -genkey -v -keystore android/mc-release.keystore -alias missioncontrol \
  -keyalg RSA -keysize 2048 -validity 10000
npm run android:sync
cd android && ./gradlew assembleRelease
```

`android/mc-release.keystore` and `android/keystore.properties` are gitignored;
a signing key must never enter the repository. The release signing block in
`android/app/build.gradle` still needs to be added to read from
`keystore.properties` — `assembleDebug` works today, `assembleRelease` does not
until that is configured.

| # | Step | Result |
| --- | --- | --- |
| 1 | Install the APK; the app launches and shows the biometric prompt | |
| 2 | Cancel the prompt: the app shows the locked message and no data | |
| 3 | Reopen and authenticate: the login screen appears | |
| 4 | Enter Jira email + PAT and connect: success toast naming the resolved user | |
| 5 | Enter TestRail email + API key and connect: success toast | |
| 6 | Backlog loads real issues; at least one key matches Jira in a browser | |
| 7 | Tap an issue: the detail dialog opens full-screen, comments and worklogs render | |
| 8 | Add a comment; confirm it appears in Jira from a browser | |
| 9 | Log work; confirm the worklog in Jira | |
| 10 | Perform a transition; confirm the new status in Jira | |
| 11 | Long-press an issue card: the context menu opens at the touch point | |
| 12 | Runs tab lists TestRail runs; opening one renders tests and results | |
| 13 | Force-stop and reopen: biometric prompt, then the Backlog loads **without re-entering credentials** | |
| 14 | Background for six minutes and return: the biometric prompt appears again | |
| 15 | Airplane mode: the Backlog shows a network error, not a blank screen or a crash | |
| 16 | Rotate to landscape on a tablet or large phone: the desktop grid appears above 900px | |
| 17 | The hardware back button inside a dialog closes the dialog, not the app | |
| 18 | Settings → Disconnect, then force-stop and reopen: the login screen appears with no stored PAT | |

## Known Phase 1 limitations

- No saved JQL filters, teams, pinned boards or board workspaces: those
  repositories are row-shaped and would need a desktop schema migration.
  `/api/filters` returns an empty list so the Backlog's JQL dialog still works.
- No Confluence: it is hosted on an internal-only name
  (`v-indigo-confluence.inr.rd.hpicorp.net:6443`) with no external counterpart.
- No Lumo and no AI features.
- No reminders: the desktop implementation is built on Windows `schtasks.exe`.
- No offline write queueing.
