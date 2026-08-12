# Mission Control — Jira UI Parity Contract (WPF → React)

Derived from actual WPF source under `C:\APPS\MissionControl\src\MissionControl.App\`. Behaviors marked **[code-behind]** live in `.xaml.cs` and must be re-implemented as React handlers.

---

## 0. Global shell

### 0.1 `MainShellViewModel`

**State**
| Property | Notes |
|---|---|
| `CurrentPage` | resolved VM instance from navigation (singleton per VM type) |
| `ConnectedAs` | `session.CurrentUser.DisplayName` |
| `ProfileName` | `session.Profile.ProfileName` |
| `LiveStatus` | literal `"Live"` |
| `LastRefreshUtc` | set on every scheduler `Tick` |
| `RefreshRunning` | true only during hard-refresh |
| `ActivePage` | string, shown in top bar next to wordmark |
| `PinnedBoards` / `HasPinnedBoards` | from PinnedBoardRepository per profile |
| `RecentIssues` / `HasRecentIssues` | **capped at 3 displayed**, persisted list holds 10 |
| `Pomodoro` | PomodoroService singleton bound in top bar |
| `Lumo` | LumoViewModel |

**Nav map (`Navigate(page)`)** — exact strings:
`Dashboard`, `MyWork`, `Incidents`, `Boards`, `Dashboards`, `TimeSpent`, `Filters`, `RecentUpdates`, `JiraBrowser`, `Team`, `Settings`.

> Note: `Dashboards` and `Filters` are routable but **not in the visible WPF sidebar**. Sidebar shows: Dashboard, My Work, Incidents, Boards, Time Spent, Recent Updates, Jira, Team, [Pinned Boards], [Recent], separator, Settings. **JiraWeb: include Dashboards + Filters in sidebar** (web has room; parity means routable either way).

**Commands**: `OpenPalette`, `OpenRecentIssue`, `OpenPinnedBoard` (loads MyWork board mode, sets ActivePage = board name), `UnpinBoard`, `RefreshNow`, `Navigate`.

**`RefreshNowAsync` (hard refresh)** — order matters:
1. issue cache ClearAll → 2. metadata cache ClearAll → 3. create-meta cache ClearAll → 4. ResetFieldCache → 5. scheduler.TriggerNow().

**Scheduler startup**: `settings.AutoRefreshEnabled` → `scheduler.Start(settings.RefreshIntervalSeconds)`.

### 0.2 Top bar (left→right)
- `☰` sidebar toggle
- Wordmark: **"MISSION"** AccentCyan + **" CONTROL"** TextPrimary, 16px bold → JiraWeb: "JIRA" + " WEB" or keep style
- `ActivePage` muted, offset 24px
- Right cluster: status dot + `LiveStatus`; `Last refresh: {HH:mm:ss}`; **`+ Create Incident`** (opens create-issue); **Pomodoro widget** (Status text, Elapsed hh:mm:ss while running, ▶ play opens palette titled "Pick issue for Pomodoro", ⏸ pause/resume, ■ stop → alert `Logged {min}m on {key}` if ≥60s); 🔍 palette; Theme toggle; Refresh (disabled while running, `…` in AccentCyan); `ConnectedAs`.

**Keyboard**: `Ctrl+K` and `Ctrl+L` → open palette.

**Lumo overlay**: floating panel bottom-right + 56×56 circular gradient FAB (`#4F46E5`→`#7C3AED`, drop shadow blur 20/opacity .55) bottom-right 24px inset, robot icon.

---

## 1. Dashboard

### Data
**KPI widget row** (cards, 120px min, radius 6, muted 10px title + 18px bold colored value):
| Id | Title | Value | Color |
|---|---|---|---|
| `OpenIssues` | My Open Issues | snap.OpenIssues | `#1FE0E0` |
| `Critical` | My Critical | snap.CriticalIncidents | `#EF4444` |
| `OnHold` | On Hold | count of sprint issues whose Status contains "hold" | `#FFA13A` |
| `UpdatedToday` | Updated Today | snap.UpdatedToday | `#FFD23A` |
| `LoggedToday` | Logged Today | `{h}h {mm}m` | `#22D38F` |
| `LoggedThisWeek` | Logged This Week | `{h}h {mm}m` | `#7A5CFF` |

Enabled set + order from `AppSettings.DashboardWidgets`; legacy id `"Blocked"` migrated to `"OnHold"` on read.

**"My Current Sprint" card** — header + subtitle *"Active-sprint issues assigned to you. Drag cards in Kanban to change status."*; right: 🔍 + UserSearchPicker (SprintUsers/UserFilter) + Kanban/Table radio (default **Kanban**).

**Table columns** (grid key `Dashboard.SprintTable`): ★ 34 (sorts IsStarred), Key 100, Summary 500, Status 140, Priority 120, Sprint 200, Assignee 160, Reporter 160, Updated 180.

**Kanban**: 5 equal columns from `KanbanLayout` (§12.1). Header `Title` + `CountDisplay` (`"{n}"` or `"{n} / {cap}"` with WIP limit); count in AccentRed when over limit.

**Card anatomy**: Row1: ★ (Gold starred / LightGray, tooltip "Star this issue (cross-tab)"), 8×8 **aging dot** (tooltip "Stalling — not updated recently"), Key bold AccentCyan. Row2: Summary wrapped. Row3: **Epic chip** when EpicKey — bg = deterministic HSL hash of epic key, fg black/white by luminance, text = EpicName ?? EpicKey, max-width 220 ellipsis, tooltip EpicKey.

### Actions
- **Star click**: flip IsStarred first (kanban rebuild floats it), then StarredService.Toggle.
- **Double-click card/row** → issue details.
- **Drag card → column**: source opacity 1→0.35 (120ms); ghost follows cursor; column border DodgerBlue on drag-over. Drop: `GetTransitions(key)` → first where ToStatus == columnTitle, else ToStatus.Contains(title), else Name.Contains(title). None → alert *"No workflow transition leads from '{status}' to '{title}'."* Then transition screen probe; if fields exist **or** NeedsCloseDialog (column title contains done/closed/resolved/reopen, or transition name contains close/resolve/reopen/reassign/fix) → TransitionDialog, else bare transition. Success: reload + toast `("Status changed", "{key} → {title}")`. Failure → toast `("Drop failed", "{key}: {msg}")`. No-op if already in target column.
- **Right-click column header** → prompt `WIP limit` "Maximum issues for '{Title}' (blank to clear):" → `AppSettings.KanbanWipLimits[title]` (blank removes; must be >0), reload.
- **Keyboard** (kanban only, not when input focused): `J`/`↓` next card, `K`/`↑` prev (flat index across columns), `Enter` opens focused card.

### Filters / sorting / refresh
- UserFilter change → server-side JQL swap reload.
- Sort: `IsStarred DESC`, then `OriginalOrder`. StarredService change → re-sort + rebuild.
- scheduler.Tick + session.Changed → LoadAsync. On construction hydrate from cache key `dashboard:recent`. Commit values only after snapshot succeeds (no clear-then-load flash).

### JQL
```
project = {X} AND sprint in openSprints()
  AND {assignee = currentUser() | assignee = "{UserFilter}"}
  AND statusCategory != Done
ORDER BY priority DESC, updated DESC     -- maxResults 200
```
User picker roster = sprint assignees ∪ distinct assignee field values (2000).

---

## 2. My Work

Header "My Work". Toolbar: search box placeholder *"🔍 Search by key or summary..."* (`KeyContains`, live), UserSearchPicker (AvailableUsers/AssigneeFilterUser), `Kanban` checkbox (default **false**).

**Quick-filter chip row** (kanban mode only): label `QUICK FILTERS:` + `All` chip + one chip per board quick filter (tooltip = chip JQL). AccentCyan chips.

**Table columns** (grid key `MyWork.Issues`, multi-select rows):
★ 34 · Sprint 160 · Key 100 · Summary 320 · **Type 120** · **Status 140** · **Priority 120** · **Assignee 180** · Updated 160 · Created 160 · Time Spent 100 · Remaining 100.
Bolded headers have **column filter popup**: `▾` + `(n)` count in AccentCyan; popup 220px, scrollable checkbox list max 260px, `Clear`/`Apply`.

**Kanban** (5 columns): card = Key bold AccentCyan + Summary + Priority colored. No star/aging/epic on MyWork cards (WPF); drag not wired in WPF — **JiraWeb: wire drag same as Dashboard** (parity-as-designed).

### Filtering model
- View = free-text (Key OR Summary, ci) AND 4 column filters.
- Filter with zero checked options = no constraint (matches all).
- **Cascading options**: each dropdown rebuilt from rows passing all *other* filters. Checked state survives rebuilds by name.
- Assignee-chip fallback: no board quick filters → chips from distinct assignees of loaded issues.

### Saved queries
From `AppSettings.SavedQueries`. `SaveQuery` (prompt name, replace same-name, insert at 0, **cap 25**), `DeleteSavedQuery`, `Export` (queries.json, indented), `Import` (merge by name, cap 25) — toasts. Selecting sets `Jql` + reload.

### Assignee filter → JQL rewrite
Split trailing `ORDER BY`, strip existing `AND assignee = ("..."|currentUser())`, append new clause, re-attach ORDER BY, reload. Quick filter: remove previously appended quick clause (tracked), append `AND ({filter.Query})`.

### Loading / delta fetch (critical semantics)
Cache key `mywork:{Jql}`:
1. Paint cached rows instantly.
2. Last refresh missing or older than **1 hour** → stale.
3. Fresh: delta query — inject `AND updated >= "yyyy-MM-dd HH:mm"` (last refresh **−2 min**) before ORDER BY. Stale/empty: full JQL.
4. Merge delta into cached dict by Key (ci), apply stars, replace list.
5. TotalCount = server Total on full fetch, else merged count.
6. Persist merged; populate user list once (sprint JQL 1000 + current user).

Page size 200. Default JQL:
```
project = {X} AND assignee = currentUser() AND statusCategory != Done
ORDER BY Sprint ASC, updated DESC, created DESC
```

### Pinned-board mode (`LoadForBoard`)
Force kanban, clear assignee filter (no reload trigger):
```
filter = {board.FilterId} AND statusCategory != Done ORDER BY Sprint ASC, updated DESC, created DESC
-- fallback (FilterId null): project = {X} AND statusCategory != Done ORDER BY ...
```
Load Greenhopper quick filters for board id; empty/failed → assignee chips.

### Row context menu
`Open details` · `Change status ▸` (lazy, §12.4) · — · `Bulk: add comment to selected` · `Bulk: add label to selected` · `Bulk: open all selected` (**cap 8**) · `Bulk: copy keys to clipboard` (comma-joined, toast "Copied"). Bulk ops report `"{ok} succeeded, {fail} failed"` toast.

Refresh: scheduler.Tick + session.Changed.

---

## 3. Incidents ("Indigo SW Incidents Dashboard")

### Layout
Page scrolls vertically. Header: title, pill `Active filters: {n}` (n AccentCyan bold), `Open in Jira`, `Clear All`.

**Filters** in collapsed-by-default expander:
1. **Quick-filter pills** (toggle chips) — 30, from IncidentFilterCatalog (see rest-layer doc §7).
2. **Dropdown filter chips** (min 120px) — label = `"{Name} ({n})"` when checked + `▾`. Popup 280px/max 420: source debug line (AccentCyan), live search box, scrollable checkbox list, `Clear`/`Apply`, `Loading...`.
3. **Summary search box** *"🔍 Search summaries..."* — **client-side** substring on Summary OR Key.

**Three stacked sections**, colored header bar + card + grid + pager:
| Section | Header | Bar | Columns |
|---|---|---|---|
| All | `SW Incident / Incidents & RCs` | `#1B5BAA` | Key 100, Summary 320, Type 120, Status 140, Priority 100, Severity 100, Assignee 160, Reporter 160, Fix Version (FixVersions[0]) 160, Sprint 160, Updated 160 |
| Verification | `SW Incident / Verification Incidents` | `#1B5BAA` | Key, Summary, Priority, Severity, Assignee, Reporter, Fix Version, Sprint, Updated |
| Rejected | `SW Incident / Rejected Incidents` | `#B8323A` | Key, Summary, Priority, Severity, Assignee, Reporter, **Reject Reasons 220**, Fix Version, Sprint |

Header bar right: `{First}-{Last} of {Total}` white 85%. Grid keys `Incident.All/.Verification/.Rejected`. **Pager: page size 10**, `◀` numbered `▶`.

### Actions
Row context menu: Open details, Change status ▸ (patch row in place). Double-click → details. `Open in Jira` → settings DashboardUrl (http/https only else error "Dashboard URL must be http or https."). `Clear All` wipes everything + reload. Removable active-filter chips.

### Dropdown option resolution
| Field (lower) | Source |
|---|---|
| assignee / reporter / primary developer / primary tester | distinct issue field (5000) |
| fixversion / affects version | distinct-from-issues → fallback versions(project) |
| components | distinct → fallback components(project) |
| priority / status / issuetype | metadata lists |
| else | distinct (5000) → fallback field suggestions |
On commit: display label → real JQL clause via ResolveJqlField (`cf[NNN]`), template `{clause} in ({values})`. Options lazy on first open, cached.

### JQL composition — see jira-rest-layer.md §6 (exact ordering).
All three searches parallel, maxResults 200 each.

### Persistence
`AppSettings.IncidentFiltersJson` = `{filterId: string[]}`, + `IncidentSummarySearch`, `IncidentDashboardUrl`. Restored at startup (inject saved values missing from options). Guard against write-back during restore.

Refresh: scheduler.Tick + session.Changed. Summary search local re-slice.

---

## 4. Boards Search

- Header "Boards Search" + `Total: {n}`. Row: live search, `Reload`, `Force refresh` (tooltip "Drop cache and pull boards fresh from Jira").
- Error line (AccentRed) + Diagnostics line (muted): `Greenhopper: {n}[ (err)]  |  Agile: {n}[ (err)]  |  All: {total}  |  Indigo only: {n}`.
- Grid (`BoardSearch.Boards`): Name `*`, Type 120, Filter 160, **Pin** column with `📌 Pin` button.
- Empty state: *"No boards available. Click Reload, or check your Jira agile/board permissions."*
- **Filters boards to names containing "indigo"** (ci) — HP instance returns thousands.
- Search client-side on Name OR FilterName.
- Force reload deletes cache key `meta:{profileId:N}:boards` then reloads.
- Pin upserts PinnedBoard + refresh shell sidebar. Loads on session change; no scheduler.

---

## 5. Filters (saved JQL)

- Two columns 2fr/3fr. Left: "Saved Filters", `New filter`, list (Name semibold + Description muted). Right editor card: Name, Description, **JQL textarea h=120**, `Save`/`Run`/`Delete`, results grid (`Filters.Results`): Key 100, Summary `*`, Status 120, Priority 100.
- Save requires Name + JQL else dialog "Name and JQL are required."
- Run executes **editor JQL** (not saved), maxResults 200, stamps LastUsed.
- Local repository; loads once; no auto-refresh.

---

## 6. Recent Updates

- Header + `🔍 User:` UserSearchPicker.
- Grid (`RecentUpdates.Updates`): Key 100, Summary 280, Status 140, Priority 100, Updated 160, **What changed** `*` (ChangeSummary).

**JQL** (maxResults 50, NOT project-scoped):
```
updated >= -7d AND (assignee = currentUser() OR reporter = currentUser() OR worklogAuthor = currentUser())
  -- user picked: (assignee = "X" OR reporter = "X")
ORDER BY updated DESC
```

**Change detection**: in-memory snapshot dict (Updated, Status, Assignee, Priority, TimeSpent) from previous poll. Diff strings joined `"; "`:
`Status: A → B` · `Assignee: A → B` (null → `—`) · `Priority: A → B` · `Worklog +{delta:0.##}h` · `Other field updated` · `First seen`. Sets RecentlyChanged when Updated differs.

Refresh: scheduler.Tick + session.Changed. UserFilter reloads. Roster = feed assignees ∪ distinct (2000).

---

## 7. Time Spent

### Layout top→bottom
1. Toolbar right: `Export to Excel/PNG`, `Export PDF`.
2. **Log work expander** (collapsed): `Selected: {key}  Epic: {epic}` (`—` none), date picker, time textbox (tooltip "Time format: 1h 30m, 45m, 2h", default "1h"), `Log work` button → opens LogWork modal. Success: `LogStatus = "Logged work on {key}."` + reload.
3. **Charts card**, three collapsed expanders:
   - *Logged vs Estimated chart* (h 220)
   - *Logging per day in sprint* — Sprint select (AvailableSprints) + chart (h 280)
   - *Activity heatmap (last 13 weeks)* (h 120)
4. **Weekly timesheet card**: nav `◀` / pill `d/MMM/yy – d/MMM/yy` / `▶` / `This week`; right `Total: {t}` AccentGreen bold. Grid: Issue 240 | Key 100 | Logged 80 | 7×48px day cells (`dd` bold over `DDD` 70%). Row per issue; totals row bold.
5. **Issues grid** (`TimeLogged.Issues`): Key 100, Summary `*`, Status 120, Sprint 160, Work Logged 120, Total Spent 120, Estimated 120, Remaining 120.
6. **Sticky footer**: `Total Work Logged: {Total}` AccentGreen bold.

### Periods & filters
Periods: Today, Yesterday, ThisWeek, PreviousWeek, ThisMonth, CustomRange (from/to). Period/user change → reload. User filter swaps JQL:
```
project = {X} AND sprint in openSprints() AND assignee = "{user}" AND issuetype != Incident ORDER BY updated DESC
```
Cache key `timelogged:{Period}:{From:yyyyMMdd}:{To:yyyyMMdd}`, hydrated on mount.

### Charts (use dataviz-compliant React charting)
**Logged vs Estimated** — per issue two bars: Estimated indigo `#4F46E5`; Logged emerald `#10B981` (≤ est) / rose `#EF4444` (> est). Skip issues with both zero. Tooltip: `{Key}  {Summary}\nEpic: {EpicKey|—}\nEstimated: {x} h\nRemaining: {x} h\nLogged: {x} h`. Category labels angled ~50°.
**Logging per day (sprint)** — horizontal stacked bars, rows = days (`ddd dd MMM`), series per issue key ordered by desc total. Palette cycle: `#4F46E5 #10B981 #F59E0B #EF4444 #06B6D4 #A855F7 #EC4899 #84CC16`. Tooltip `{ddd dd MMM yyyy}\n{Key} {Summary}\nLogged: {x} h`.
**Heatmap**: §12.6.

### Exports
- **Excel/PNG**: base name → `{stem}-issues.csv` (`Key,Summary,Status,Sprint,WorkLoggedHours,TotalSpentHours,EstimatedHours,RemainingHours`, hours 0.##, RFC-4180), `{stem}-daily.csv` (`Date,Hours`), 2 chart PNGs 1400×700. Toast.
- **PDF**: A4 portrait, header `Time Spent — {yyyy-MM-dd HH:mm}`, total, both charts, table Key|Summary|Logged|Total|Est|Rem, page footer `Page N / M`. (Web: print-friendly view or client-side pdf lib.)

Refresh: session.Changed only — **no scheduler tick**.

---

## 8. Dashboards (Jira dashboards)

2fr/3fr. Left: heading, live search (Name only), list (Name + Owner). Right: selected name, `Open in Jira` (ViewUrl), `Load gadgets`, disclaimer *"Most native Jira gadgets are not rendered in V1 — open in Jira for full view."*, gadget cards (Title + ModuleKey). Loads once; no auto-refresh.

---

## 9. Team Dashboard

**Header**: title; `Team:` select + `Project:` textbox (100px live); right `New team` / `Edit` / `Delete` / `Refresh`.

**Empty state**: centered card — "No teams yet" / "Create a team to track only your squad's workload and logged time." / `+ New team`.

**Stats band**: `Logged this week (team)` `{0:0.#} h` · `Remaining (open issues)` `{0:0.#} h` · `Members {n}` — 22px bold.

**Charts row** (260px, two cards):
- Workload (open issues per member), horizontal stacked: In Progress `#06B6D4`, In Review `#F59E0B`, On Hold `#EF4444`, Other `#64748B` (`Other = max(0, Open − IP − IR − OH)`).
- Logged hours (sprint), single indigo `#6366F1` bar per member.

**Table** (`TeamDashboard.Rows`, tooltip "Double-click a member to open details"): Member 220, Open 70, Done 70, In Progress 100, In Review 100, On Hold 80, Estimated (h) 110, Remaining (h) 110, Logged (h) 100. Sorted OpenCount DESC.

**Behavior**
- JQL: `project = {X} AND sprint in openSprints() AND issuetype != Incident ORDER BY assignee ASC`, maxResults 1000. No status filter — done/closed by substring.
- **Fuzzy member matching**: normalize = local part before `@`, strip non-alphanumerics, lowercase (`Adir Takiar` ≡ `adir.takiar@hp.com`).
- Counters: Open = not done/closed; Done = done|closed; OnHold contains "hold"; InProgress contains "in progress"; InReview contains "review". Hours from OriginalEstimate/RemainingEstimate/TimeSpent.
- Team select persists ActiveTeamId; ProjectKey persists DefaultProjectKey + reload.
- Delete confirm "Delete team '{name}'?".
- Double-click row → member detail window.
- Loads on session.Changed; no scheduler.

### 9.1 Team editor (modal 520×640)
Fields: Team name; Project + `Load` + member search; checkbox list; error line; Cancel/Save.
Member source order: (1) sprint assignees (current sprint only, 1000); (2) + logged-in user; (3) if ≤1, fallback all-time distinct (2000); (4) always re-add already-selected. Validation: name required ("Team name is required."), ≥1 member ("Pick at least one member.").

### 9.2 Member detail (980×640)
Header name + Close. Stats: Features / Logged (h) / Remaining (h). Charts: hours/day last 7 days (stacked per issue) + logged vs estimated per feature (top-12 by est+logged; Logged `#6366F1`, Estimated `#64748B`). Grid: Key 100, Type 90, Summary `*`, Status 120, Priority 90, Logged (h) 90, Remaining (h) 100, Last Logged 140. Load: seed rows from passed issues (TimeSpent DESC), fetch worklogs parallel (gate 8), filter to member by normalized name, LastLogged = max Started, LoggedHours overwritten with member sum when >0, re-sort LastLogged DESC.

---

## 10. Windows & dialogs

### 10.1 Issue details (1400×900, modeless → web: large modal/route)
**Header**: `{ProjectKey} / {Key}` (key AccentCyan) + Summary 20px.
**Action bar**: `◀`/`▶` history · one primary button per transition (tooltip `Move to: {ToStatus}`) · `Log work` · `Copy key` · `Open in Jira` · green TransitionStatus line.
**Body** 3fr/2fr, single scroll:
Left: **Parent link** (label = ParentFieldLabel ?? "Parent"; underlined AccentCyan `{ParentKey} — {ParentSummary}` → opens parent) · **Details** (2-col: Type, Status colored, Priority colored, Severity, Sprint, Reject Reasons) · **All fields** (200px labels, values via IssueLinkText) · **Description** · **Activity timeline** (Kind badge 64px AccentCyan, Author + When right muted, Summary) · **Comments** (author + date, body via IssueLinkText; add-comment box + button + green status) · **Worklogs** (Author, Started, TimeSpent AccentGreen, Comment).
Right: **People** (Assignee, Reporter) · **Dates** (Created, Updated) · **Time Tracking** (Logged, Remaining).

**Description rendering**: `DescriptionHtml` empty → plain text or "(no description)". Otherwise rendered HTML (server proxies attachment images injecting auth header — WPF used WebView2 + Authorization on every request; JiraWeb: server route `/api/jira/attachment-proxy?url=` adds PAT). CSS: 13px `#E8EEFA`, `img{max-width:100%}`, `a{color:#1FE0E0}`, `pre,code{background:#1B2436;padding:6px;border-radius:4px}`, tables collapsed `1px solid #334155`. Inject `<base href={BrowseUrl}>` equivalent by rewriting relative URLs.

**Navigation history**: back/forward stacks; push only when key differs.
**Transitions**: screen probe → dialog if fields, else bare; reload; `TransitionStatus = "Status: {new}"`; failure alert "Transition failed".
**MRU**: RecentIssues dedup newest-first cap 10, mirror RecentIssueKeys, top 3 in sidebar.

### 10.2 Create issue (780×780)
- **Hardcoded**: project `ISW` / type `Incident`, shown "Indigo Software (ISW)". Subtitle "Required fields are marked with an asterisk *". Loading state while meta loads.
- Field kinds: text / longtext (h100) / select / multiselect (checkbox list max 120px) / date (`yyyy-MM-dd`) / datetime (`yyyy-MM-ddTHH:mm:ss.000zzz`) / number (double) / user (`{name}`). Kind: AllowedValues → multiselect if schema array else select; string named Description|Environment → longtext. Label + ` *` if required.
- Footer: `Create another` · `Save as defaults` · `Clear defaults` · `Open in Jira` (opens Jira create URL in new tab) · `Create` · `Cancel`.
- **Meta loading**: disk cache key `ISW:Incident` → paint; empty → hardcoded fallback skeleton (Summary*, Priority* Highest..Lowest, Program* Indigo 7/8/12/14/15/17/35/100K/Future/Common, Reproducibility* Always/Often/Sometimes/Once/Rare/Did not try, Environment Affected* Production/Customer/Lab/Test/Development, Severity S1–S6, Description); refresh if cache older than **14 days**, 15s hard timeout → error msg suggesting "Open in Jira". Preserve Jira response order; snapshot+restore user-entered values on repopulate.
- **Priority automation** (Severity+Environment+Reproducibility all set):
```
sevTier: S1|CRITICAL|HIGHEST=1, S2|HIGH=2, S3|MEDIUM=3, S4|LOW=4, S5|LOWEST=5, S6=6, else 3
envBoost: Production=-1, Customer=-1, Lab=+1, Test=+1, else 0
reproBoost: Always=-1, Often=0, Sometimes=+1, Once=+1, Rare=+1, else 0
tier = clamp(sum, 1, 5) → 1 Highest, 2 High, 3 Medium, 4 Low, 5 Lowest
```
User can override; recompute on driver change.
- **Submit**: no client-side required validation (Jira authoritative). Empty fields omitted. Success `"Created {KEY}."`; Create-another resets only text|longtext|number, keeps selects, re-applies defaults.
- Defaults store + meta cache per storage-layer doc §4.2/4.3.

### 10.4 Log work (modal 640)
Title `Log Work: {key}`. **Time Spent*** (hint "(eg. 3w 4d 12h) — estimate of time you spent working."), **Date Started*** (default now), **Remaining Estimate** radios: Adjust automatically (default, hint "The estimate is reduced by the amount of work done, but never below 0.") / `Use existing estimate of {N}` (only when remaining exists; `{h:0.##} hours` if ≥1h else `{m:0} minutes`) / `Set to` + input / `Reduce by` + input. Work Description textarea h120. Validation: time parse > 0 else "Time Spent must be like '1h 30m', '45m', '2h'."; Set-to/Reduce-by need value. Maps to adjustEstimate Auto|Leave|New|Manual.

### 10.5 Transition dialog (modal 640×640, dynamic)
Title = transition name; subtitle `{key}  →  {toStatus}`. OK label = transition name.
- Required = Jira flag OR name heuristic: contains *verified in build, time spent, reopened reason, on hold reason, resolution, rejected reason, reject reason, cancel reason* → red `*`.
- Controls: allowedValues or schema option|resolution|priority → select (resolution preselect Fixed → Done → Resolved → first); date|datetime → date picker (today); user → text (tooltip "Jira username or email"); timetracking → text ("Time format e.g. 3w 4d 12h"); else text.
- Special ids: `comment` skipped (bottom box); `worklog` renders required "Time Spent" → Result.TimeSpent; `assignee` → Result.Assignee.
- Value shaping: option|resolution|priority|user → `{name}`; date `yyyy-MM-dd`; datetime `yyyy-MM-ddTHH:mm:ss.fffzzz`; number double; timetracking `{originalEstimate, remainingEstimate}` both = input; else raw.
- Bottom: Comment textarea h80; error line; Cancel/OK. Client required check: `Required: {names}`.

### 10.6 UserSearchPicker (reusable)
Input placeholder *"👤 Search users..."* + `✕` clear + dropdown list. Results substring ci, sorted, **Take(50)**. Opens on focus/keystroke when ≥1 match. `↓` into list, `Enter` box commits raw text, `Enter` list commits selection, `Esc` closes, click commits. Empty = no filter.

### 10.7 TextPrompt (modal 420×180): title, message, single input, Cancel/OK.

### 10.8 Toast
360px wide card bottom-right, 16px inset: bg `#1F2937`, border `#334155`, radius 8, padding 14, shadow. Title 13px semibold `#E8EEFA`; body 12px `#94A3B8`; `✕`. **Auto-dismiss 8s.**

### 10.9 Help (modal 960×780)
Static reference. **Visual Legend is the color contract**: ★ gold starred/floats; ★ gray not; ● green `#10B981` updated ≤2 days; ● amber `#F59E0B` 3–6; ● red `#EF4444` 7+; `N / Cap` red over WIP; indigo `#4F46E5` = Original Estimate; emerald logged under; rose logged over; heatmap darker green = more hours. Sections: Pages, Visual Legend, Kanban, Charts, Issue Details, Top Bar, Cmd-K Palette, Sidebar, User Picker, Worklog Reminder, Data Grids, Persistence, Backup, Recent Updates, Keyboard Shortcuts. Footer version info.

### 10.10 Lumo panel + card modal
**Panel** 430×560 radius 20 shadow. **Header** always indigo gradient `#4F46E5`→`#7C3AED`: avatar 40×40, "Lumo" 15px white, `powered by {ModelName}` 10px `#DDD6FE`, `🗑` clear + `✕`.
**Context bar**: Project input (80px) + Model select: `claude-sonnet-4.6`, `claude-opus-4.6`, `claude-haiku-4.5`, `gpt-5.2`, `gpt-4.1`, `gemini-2.5-pro`.
**Messages**: user bubble right `#4F46E5` radius 18,18,6,18 white, max 320; assistant left avatar 34 + panel bubble radius 6,18,18,18. **Card groups** (indent 42): source dot + label + `Table` ⇄ `Cards` toggle. Source map: jira "Jira" `#2563EB` · confluence `#1D4ED8` · testrail `#059669` · github `#374151` · default capitalized `#4F46E5`. Cards: 190×160 horizontal scroller — source badge, title 12px 2-line, summary 11px, `Read →` `#818CF8`. Table view: rows Title `#818CF8` bold + Summary, hover `#22818CF8`.
**Status row** while thinking: `●●●` `#818CF8` + StatusText.
**Input**: rounded 10, 1.5px `#4F46E5` border, placeholder "Ask Lumo anything...", send `➤` 40×40 indigo, disabled while thinking. Enter sends.
**Card click**: source jira + title has issue key regex → open issue details; else card modal.
**Card modal** 560×500: dark palette bg `#0D0D1A`, border `#373766`; header `#151528` with `#2563EB` badge; body summary `#CBD5F5` + 120px-label kv list (`#94A3B8`/`#E2E8F0`); footer `#0F0F22` URL `#64748B` + `Open in browser ⤴` (`#4F46E5`) hidden without URL.
**VM behavior**: on send append user msg, clear input, status "Lumo is thinking...", persist Project/Model to settings, build turns from non-status messages, call Lumo agent with progress → StatusText, append assistant msg + cards. Exception: error + append "Hmm, I ran into a problem: {msg}".

---

## 11. Command palette

660×440 modal. Query input auto-focused; results list; footer *"Type to search Jira · Enter to open · Esc to close"*. Row: Group 130 bold AccentCyan 11px · Key 80 bold muted · Summary ellipsis. **Debounce 180ms** + cancellation. Keys: `↓` first result, `Enter` box → index 0, `Enter` list activates, `Esc` closes, double-click activates. Errors → synthetic row group "ERROR".

**WPF palette is a stub** (TestRail-only search, no navigation). Help doc documents the intended spec — implement in JiraWeb: search = navigation entries + live Jira issues by key/title + recent issues; `>` command mode (backup, etc. optional); pomodoro pick mode (title "Pick issue for Pomodoro", selection starts pomodoro on issue).

---

## 12. Shared primitives

### 12.1 KanbanLayout
Fixed order — **To Do, In Progress, On Hold, In Review, Done** — lowercase substring match:
| Column | Status contains |
|---|---|
| To Do | `to do`, `not started`, `open`, `backlog`, `new` |
| In Progress | `in progress` |
| On Hold | `hold`, `blocked`, `waiting` |
| In Review | `review`, `verification` |
| Done | `done`, `closed`, `delivered` |
Column: Title, Issues, Count, WipLimit?, IsOverLimit = Count > cap, CountDisplay.

### 12.2 PagedView: page size **10**, GoTo/Next/Prev, FirstOnPage/LastOnPage/TotalPages = max(1, ceil).

### 12.3 Chart style
Palette order: Indigo `#6366F1`, Cyan `#06B6D4`, Amber `#F59E0B`, Emerald `#10B981`, Pink `#EC4899`, Red `#EF4444`, Slate `#64748B`. Title bold 13 `#1F2937`; value axis min 0 dotted gridlines `#3394A3B8`; category no gridlines; legend outside right-top.

### 12.4 Change-status submenu
`Loading...` → one item per transition `"{Name}  →  {ToStatus}"`; empty `(no transitions available)`; error `Error: {msg}`. Click: screen probe; dialog if fields or NeedsDialog (name contains *fix, close, resolve, done, cancel, reject, reopen, reassign, assign* OR target contains *closed, done, resolved, cancel, reject, reopen*). After success **refetch single issue live** and patch row in place. Failure alert "Transition failed".

### 12.5 JiraTimeFormat
Parses `1h 30m`, `2h`, `45m`, `30s`, `1.5h`, `1,5h` (comma decimal). Units: `w = 5×8h`, `d = 8h`, `h`, `m`, `s`; unknown unit contributes 0; trailing bare number = hours. False on total ≤ 0 or unparseable numeric token.

### 12.6 Heatmap
7 rows (weeks start **Sunday**) × 13 week columns. Cell 14px gap 2. Oldest left. Future days skipped. `hours <= 0` → `#33666666`; else green ramp `rgb(0x10, 0x40 + ratio*(0xC8-0x40), 0x60)`, `ratio = min(1, hours/max)`.

### 12.8 Converters / formatting
| Name | Behavior |
|---|---|
| AgingDot | days since Updated (local): ≥7 `#EF4444`, ≥3 `#F59E0B`, else `#10B981`; visibility mode shows dot only ≥3 days; hidden when Updated == epoch/min |
| EpicDisplay | EpicName ?? EpicKey ?? "" |
| LabelColor | hash `h=23; h=h*31+lower(c)`; `hue=(h & 0xFFFF)/65535*360`; HSL(hue, .55, .45); fg Black if luminance(.2126R+.7152G+.0722B) > .55 else White |
| StarColor | Gold / LightGray |
| PriorityToBrush | highest/critical/blocker `#EF4444` · high/s3 `#FFA13A` · medium/s4 `#FFD23A` · low/s5/s6/default `#8AA0BF` |
| StatusToBrush | done|closed|delivered `#22D38F` · blocked|rejected `#EF4444` · progress|review `#1FE0E0` · default `#8AA0BF` |
| TimeSpanFormat | `0m` null/zero, else `{H}h {M}m` / `{H}h` / `{M}m` |
| RecentSummary | strip leading issue-key prefix + `: - ` from summary |

### 12.9 IssueLinkText
Regex `(?<url>https?://[^\s"<>)]+)|(?<key>\b[A-Z][A-Z0-9_]+-\d+\b)`:
- Issue keys → DeepSkyBlue underlined link, tooltip `Open {key} in new window`, opens details.
- URLs → rendered as **`Link 1`, `Link 2`, …**, tooltip = URL, trailing `. , ; )` trimmed, http/https only.
Used on All-fields values and comment bodies.

### 12.10 Grid state persistence
Per-grid state key (see per-view keys). Persist DisplayIndex/Width/Hidden per column, debounced 250ms. **Right-click header** → column visibility checkboxes + `Export to CSV...` (visible columns, display order, dotted binding paths, UTF-8 BOM, filename = key with `.`→`_`). JiraWeb: localStorage per state key; CSV client-side download.

### 12.11 RefreshScheduler
Interval timer, min 5s. Start/Pause/Resume/TriggerNow. Allowed UI intervals: **15 / 30 / 60 / 300** s. LastRefreshUtc per tick. JiraWeb: client-side interval in shell store, pause on document hidden if PauseWhenMinimized.

### 12.13 Starred
Case-insensitive set backed by AppSettings.StarredIssueKeys. Toggle persists whole list + fires change event → dashboard re-sort/rebuild.

---

## 13. Services detail

### 13.1 AI assistant — Lumo agent loop (server-side in JiraWeb)
Lumo **always uses CLI path**. Loop max **3 rounds**, tool results truncated **2000 chars**.
Per round: status `"Lumo is thinking..."` / `"Refining (round {n})..."`; compose flat prompt `[SYSTEM]\n{system}\n\n[USER]...\n[ASSISTANT]...` + `Reply with ONE JSON object only. No prose, no markdown fences.`; run CLI; extract first balanced JSON object (strip ```json fences, brace-count respecting strings/escapes); no object → raw text as summary, zero cards. `summary` → done. `tool_calls` → per call status `"Running {name}..."`, dispatch, truncate, append assistant JSON + user turn:
```
[TOOL RESULTS]
--- {name} ---
{result}
...
Now respond with the final JSON: {"summary":"...","cards":[...]}. Do not call more tools unless absolutely needed.
```
Exhausted → `"(Stopped after max rounds without a final answer.)"`.
Tools: `search_issues(jql)` (20 results), `get_issue(key)` (description truncated 1000), `add_comment(key, body)`.
`LumoCard = { Source ("jira" default), Title, Summary, Url?, Fields: Record<string,string> }`.

**System prompt template** (`__URL__`, `__PROJ__`, `__USER__` substituted):
```
You are Lumo, the friendly AI assistant inside Jira Mission Control.
Active Jira: __URL__
Default project key: __PROJ__
Logged-in user: __USER__

## Tools
Call ONE OR MORE of these by emitting JSON. Do NOT invent issue data.
- search_issues(jql: string)             -> up to 20 issues matching JQL
- get_issue(key: string)                 -> details of one issue
- add_comment(key: string, body: string) -> append a comment

## Response format (STRICT - emit ONE JSON object, no prose around it)
Round 1 (gather): {"thinking":"...", "tool_calls":[{"name":"search_issues","arguments":{"jql":"project=__PROJ__ AND statusCategory != Done"}}]}
Final answer:    {"summary":"Plain-English answer in 1-4 sentences.", "cards":[{"source":"jira","title":"ISW-123","url":"__URL__/browse/ISW-123","summary":"...","fields":{"status":"Open","priority":"High"}}]}

## Rules
- If the user asks about issues, ALWAYS call search_issues or get_issue first - never fabricate keys/statuses.
- JQL: project=__PROJ__ unless user names another. Use ORDER BY updated DESC by default.
- Greetings / non-Jira chitchat: skip tools, return {"summary":"...","cards":[]} immediately.
- Cap cards at 10. Keep summaries to 1-2 sentences.
- After receiving [TOOL RESULTS], return the final {summary, cards} JSON. Don't loop forever.
```

### 13.2 CLI spawn (copilot.exe)
Resolution: `where copilot` → `%LOCALAPPDATA%\Programs\CopilotCLI\copilot.exe` → app bin → throw *"copilot.exe not found. Install with `winget install GitHub.CopilotCLI` and run `copilot login` once."*
Prompt → temp file UTF-8 (`%TEMP%\copilot-prompt-{id}.txt`) prefixed:
```
IMPORTANT: Do NOT call any tools (no shell, no write, no read). Respond with text only based on the request below.
```
Args: `-p "Follow ALL instructions in the file {tmp} exactly. Output ONLY the answer text, nothing else." -s --model {model} --allow-all-paths --deny-tool shell --deny-tool write --no-custom-instructions --output-format text`.
No token streaming — accumulate stdout, return trimmed after exit. Status strings are synthetic (SSE to client). 15-min timeout, kill tree. Non-zero exit → `copilot.exe exited {code}. {stderr | "(no stderr)"}`. Temp file deleted in finally.

### 13.5 Worklog reminder
Timer: first check after 1 min, then every 5 min. Skip if local hour < **17**. At most one notification per calendar day (marked even when goal met). Report Today; if total hours < **6** → toast `("Worklog reminder", "You logged {X:0.##}h today. Below the 6h target — log work before signing off?")`.

### 13.6 SafeUrl (web: link handling)
http/https only; everything opens in new tab. Confluence interception not applicable (stays in MissionControl).

### 13.7 Pomodoro
Status `Idle` / `Running on {key}` / `Paused on {key}`; Elapsed 1s tick. Pause accumulates; Resume continues. Stop: if elapsed ≥ **60s** post worklog (started = now − elapsed, optional comment); failures logged not thrown. Returns elapsed for confirmation.

---

## 14. Settings

Sections (cards) + sticky bottom bar:
- **AI Assistant**: model/endpoint fields; CLI login helper buttons (optional in web); **Dashboard widgets** reorderable checkbox list (▲/▼) → DashboardWidgets.
- **Account**: `Connected as: {name}`; Update PAT (validate via /myself, save, re-activate session); `Log out` (confirm → clear creds → login page).
- **Appearance**: Theme Dark/Light.
- **Refresh**: auto-refresh enabled, interval 15/30/60/300, pause when hidden.
- **Notifications**: in-app, critical only, mute all.
- **HP Indigo**: Default project key, Incident dashboard URL.
- Action bar: StatusMessage AccentGreen; `Clear cache` (confirm "Remove all cached issue data?" → issue cache clear); `Save`.
**Save semantics**: load-then-mutate so fields not on this page survive (recent issues, saved queries, incident filters, starred, WIP limits). Start/pause scheduler after save. Theme applies live (CSS vars).

---

## 15. Other

- **Jira Browser view**: WPF embedded WebView2 — in web becomes a page with address bar + "Open in new tab" (iframes blocked by Jira). Keep as simple launcher page or drop into nav link.
- **ProfileEditor**: fields Id, ProfileName, BaseUrl, Email, InstanceType (DataCenter default), DefaultProjectKey ("ISW"), IsDefault.

## 16. Parity gotchas

1. Two different kanban cards (Dashboard rich, MyWork minimal) — JiraWeb wires drag on both.
2. MyWork delta fetch semantics (1h stale, −2min overlap, key merge) must be preserved.
3. Incident person-scoping asymmetric (see §3).
4. Incident paging client-side (10/page over 200-row fetch).
5. Empty column filter selection = no constraint.
6. Column filter options cascade excluding own constraint.
7. Aging dots local-time compares; dot hidden below 3 days in visibility mode.
8. Lumo no streaming — three synthetic status strings via SSE.
9. Toast = only non-blocking notify; alerts for transition failure/team delete/pomodoro stop.
10. WPF palette is stub; implement documented spec (nav + Jira issues + recents + pomodoro pick).
