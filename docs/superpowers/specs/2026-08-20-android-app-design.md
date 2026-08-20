# MissionControl for Android — Design

Date: 2026-08-20
Status: Approved, pending implementation plan

## Goal

Ship a standalone Android application that provides MissionControl's Jira and
TestRail functionality on a phone, with no server component of any kind. The
app talks directly to the HP external gateway hosts over the public internet,
so it works on cellular without VPN.

Lumo (the AI assistant) and all SQLite/vector database code are out of scope
and are removed from the Android build.

## Findings that shape the design

**The gateway already accepts Personal Access Tokens.** The desktop app calls
`https://hp-jira.external.hp.com/` and `https://hp-testrail.external.hp.com`
with a Bearer PAT and an API key respectively, and those calls succeed today.
The gateway does not force a SAML round trip per REST request. An on-device
client can therefore authenticate with the same credentials the desktop app
uses, with no SSO plumbing and no session-cookie scraping.

**Confluence cannot be reached from a phone.** It is hosted at
`https://v-indigo-confluence.inr.rd.hpicorp.net:6443`, an internal-only
hostname with no external counterpart. Confluence is excluded from the Android
app. If an `*.external.hp.com` Confluence host is discovered later, it can be
added without changing this design.

**The existing service layer is already framework-free.** `server/src/jira/*`
and `server/src/testrail/*` are plain TypeScript classes built on `fetch`.
Express appears only in `server/src/routes/*`, a thin adapter, and
`server/src/routes/deps.ts` already declares narrow structural interfaces
(`IssuesDep`, `CredentialsDep`, `BoardServiceLike`, …) for those services.

**`client/src/api/client.ts` mirrors those interfaces one-to-one.** It is a
typed `fetch` wrapper whose function surface matches the route contract. This
is the seam: teaching its `request()` helper to call an in-process dispatcher
instead of `fetch` leaves every view and every API signature untouched.

## Architecture

Capacitor application: a generated Kotlin shell hosting a WebView that runs the
existing React client, with the ported service layer executing inside the same
JavaScript context.

```
Android APK (Capacitor)
├─ native shell (Kotlin, generated)
│   ├─ Keystore + BiometricPrompt plugins
│   └─ OkHttp bridge — CapacitorHttp patches window.fetch
└─ WebView: bundled Vite build
    ├─ client/src/views/*        unchanged
    ├─ client/src/api/client.ts  gains an in-process dispatch branch
    ├─ core/jira/*               moved from server/src/jira, unchanged
    ├─ core/testrail/*           moved from server/src/testrail, unchanged
    ├─ core/dispatch.ts          NEW — answers the route contract without Express
    └─ core/storage/*            NEW — repository interfaces over Capacitor
```

`CapacitorHttp` routes `window.fetch` through native OkHttp. This is load
bearing: Jira and TestRail REST endpoints send no CORS headers, so a plain
WebView or PWA cannot call them. Routing through native code removes the
browser's same-origin enforcement entirely.

### Repository layout

Three workspaces:

- `core/` — shared TypeScript logic (Jira, TestRail, storage interfaces)
- `client/` — React UI, shared between desktop and Android
- `android/` — Capacitor project and native shell

The existing desktop application keeps working against the same `core/`
package. One logic codebase, two shells.

### Removed from the Android build

`express`, `server/src/routes/*`, `server/src/app.ts`, `server/src/main.ts`,
`server/src/security.ts`, `server/src/reminders.ts`, `server/src/ai/*`,
`lumo/`, `server/src/confluence/*`, `better-sqlite3`, `sqlite-vec`,
`scripts/installer/*`.

`security.ts` guarded a loopback HTTP server against DNS rebinding, CSRF, and
local processes. With no server there is no such attack surface, so it is
deleted rather than ported.

`reminders.ts` and `settings/RemindersSection.tsx` are built on Windows
`schtasks.exe`. They have no Android equivalent in scope and are cut from this
build. Local notifications may replace them in a later phase.

## Authentication and credential storage

The app uses the same credentials as the desktop application:

- Jira: base URL, email, PAT, instance type
- TestRail: base URL, email, API key

Flow:

1. First launch shows a login screen with those fields.
2. On save, secrets (`jiraPat`, `testRailApiKey`) are written to the Android
   Keystore via a hardware-backed secure-storage plugin. Non-secret profile
   fields go to `@capacitor/preferences`.
3. On app launch, and on resume after an inactivity timeout, the app presents
   `BiometricPrompt` (fingerprint or face, with device-PIN fallback).
4. Only after a successful prompt are secrets read out of the Keystore into
   memory and `JiraSession.activate()` / the TestRail session equivalent
   called.

Secrets are never written to `localStorage`, never persisted in the WebView,
and never leave the device. Both shells satisfy the same `CredentialsDep`
interface; the DPAPI implementation stays desktop-only.

## Storage

SQLite is removed. Repository interfaces are unchanged; only the backing store
differs.

| Repository | Desktop backend | Android backend |
| --- | --- | --- |
| `AppSettingsRepo` | SQLite | `@capacitor/preferences` JSON |
| `TeamRepo`, `SavedFilterRepo`, `PinnedBoardRepo`, `BoardWorkspaceRepo` | SQLite | Not ported in Phase 1 — desktop only (see Scope) |
| `IssueCacheRepo`, `trCache*`, `trPeople*` | SQLite | `@capacitor/filesystem` JSON file, app-private storage |
| `CreateDefaultsStore`, `CreateMetaCache` | JSON file | `@capacitor/preferences` JSON |
| Credentials | Windows DPAPI | Android Keystore |

Preferences holds small structured state. The issue cache and TestRail cache
can grow to megabytes, so they live in an app-private JSON file via the
Filesystem plugin. This preserves MyWork's delta-refresh behaviour
(`CACHE_FRESH_MS`, `injectUpdatedClause`) without a database.

## Mobile UI

Views are not rewritten. `DataGrid` already accepts a declarative
`GridColumn<T>[]` carrying `header`, `render`, `format`, and `sortValue`. A new
component selects the presentation for those same column definitions:

```
components/ResponsiveGrid.tsx
  viewport >= 900px  ->  <DataGrid/>    (existing desktop grid, unchanged)
  viewport <  900px  ->  <CardList/>    (same columns, stacked cards)
```

`CardList` renders the first column as a card title, the next three or four as
label/value rows, and collapses the remainder behind a "more" toggle. Views
swap `DataGrid` for `ResponsiveGrid` and change nothing else. Desktop
rendering is unaffected.

Touch equivalents for mouse-only interactions:

- Column-resize drag: not applicable on phones, disabled below the breakpoint.
- Header right-click menu and row context menu: long-press. `ContextMenu`
  already takes `{clientX, clientY}`, which a long-press handler supplies.
- Row double-click: single tap.

Additional passes:

- `Modal` renders as a full-screen sheet below 900px. One change in
  `Modal.tsx` covers all dialogs.
- `Shell`'s sidebar navigation becomes a bottom tab bar.
- The hash router works unchanged in a WebView. The Android hardware back
  button is wired to `router.back()` through Capacitor's `App.backButton`
  listener.
- `CommandPalette` and keyboard shortcuts remain available for tablet plus
  keyboard, hidden on phone widths.

## Scope: Phase 1

Routes: `mywork`, `testrail-runs`, `testrail-run`, `settings`.

Dialogs: `IssueDetails`, `LogWork`, `TransitionDialog`.

Phase 1 is deliberately narrow: it exercises every layer of the stack —
gateway reachability, PAT auth, Keystore, biometric unlock, native HTTP,
storage, responsive grid, APK packaging — across a small surface. Remaining
views (Dashboard, Incidents, Boards, Time Spent, Team, Traceability, Case
Library, Case Editor, Reports) follow once that foundation is proven, and each
then needs only a `ResponsiveGrid` swap.

Explicitly out of scope for this project: Lumo and all AI features, Confluence,
Windows Task Scheduler reminders, the Inno Setup installer, and offline write
queueing.

Also deferred to Phase 2, because their repositories are row-shaped rather than
key/JSON-shaped and porting them would require a desktop schema migration:
saved JQL filters, teams, pinned boards, and board workspaces. On Android
`/api/filters` returns an empty list, so the Backlog JQL dialog stays usable
without saved queries.

## Build and distribution

```
npm run build --workspace client
npx cap sync android
./gradlew assembleDebug
```

Requires Android Studio and JDK 17 on the build machine.

Distribution is sideloading the APK. If HP device management restricts
sideloaded applications that hold corporate tokens, that is a policy decision
to raise separately; the application's security posture is not weaker than the
desktop build, since the Keystore is hardware-backed while DPAPI is not.

## Verification

Ordered, each step gating the next:

1. Move `server/src/jira` and `server/src/testrail` into `core/`. The existing
   vitest suites must pass **unchanged**. This is the evidence that the move
   preserved behaviour.
2. Build the web bundle and run it in desktop Chrome against the local
   adapter. This proves the routes layer was removed correctly, independently
   of Android.
3. `npx cap run android` on a physical device, on cellular with VPN off.
   Proves gateway reachability, PAT auth, and the native HTTP bridge.
4. Force-stop and reopen the app. Proves Keystore persistence and the
   biometric gate.
5. Resize desktop Chrome across the 900px breakpoint on every Phase 1 view.
   Proves `ResponsiveGrid` in both modes without needing a device.

## Open items

- Confirm whether an `*.external.hp.com` Confluence host exists. If so,
  Confluence can be added later with no design change.
- Choose the inactivity timeout that re-triggers the biometric prompt.
- Decide whether Phase 2 replaces Windows reminders with Android local
  notifications.
