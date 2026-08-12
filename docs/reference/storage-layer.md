# Storage Reference — MissionControl (for Node/TypeScript + better-sqlite3 re-implementation)

Sources read: `C:\APPS\MissionControl\src\MissionControl.Infrastructure\Jira\Storage\*.cs`, `...\Jira\Security\DpapiCredentialStorageService.cs`, `...\Shared\CredentialVault.cs`, `...\Shared\AppDataPaths.cs`, `...\Shared\UserDataMigrator.cs`, `C:\APPS\MissionControl\src\MissionControl.App\Services\StarredService.cs`, `...\Services\BackupService.cs`, `C:\APPS\MissionControl\src\MissionControl.Core\Jira\Models\AppSettings.cs`, plus supporting models/interfaces/callers.

---

## 0. Paths (all of them)

| What | Path | Defined in |
|---|---|---|
| SQLite DB | `%LOCALAPPDATA%\JiraCommandCenter\command-center.db` (dir auto-created on every `DbPath` access) | `...\Jira\Storage\SqlitePaths.cs` |
| Connection string | `Data Source=<DbPath>` — no pooling flags, no WAL, no pragmas | same |
| Per-key secrets (DPAPI blobs) | `%LOCALAPPDATA%\JiraCommandCenter\secrets\<sanitizedKey>.bin` | `DpapiCredentialStorageService.cs` |
| Credential vault (main login) | `%APPDATA%\MissionControl\credentials.dat` | `AppDataPaths.cs` + `CredentialVault.cs` |
| App root (new) | `%APPDATA%\MissionControl` | `AppDataPaths.Root` |
| Declared-but-unused | `%APPDATA%\MissionControl\settings.json`, `%APPDATA%\MissionControl\session.json` — `AppDataPaths.SettingsFile`/`SessionFile` have **zero call sites** (grep confirms only `Root` is used, for `logs`) | `AppDataPaths.cs` |
| Logs | `%APPDATA%\MissionControl\logs` | `App.xaml.cs:48` |
| DataGrid column state | `%APPDATA%\JiraCommandCenter\gridstate.json` | `...\App\Behaviors\DataGridStatePersister.cs:26-28` |
| Create-Issue field defaults | `%APPDATA%\JiraCommandCenter\create-defaults.json` | `...\App\ViewModels\Jira\CreateIssueDefaultsStore.cs:22-24` |
| Create-Issue metadata cache | `%APPDATA%\JiraCommandCenter\create-meta-cache.json` | `...\App\ViewModels\Jira\CreateIssueMetaCache.cs:15-17` |
| WebView2 user data | `%LOCALAPPDATA%\JiraCommandCenter\WebView2` | `Views\Jira\CreateIssueWebWindow.xaml.cs:31` |
| Legacy migration source | `%APPDATA%\JiraCommandCenter\*.json` → `%APPDATA%\MissionControl\` | `UserDataMigrator.cs`, `App.xaml.cs:128-131` |

Note the split: **LOCALAPPDATA\JiraCommandCenter** = DB + secrets + WebView2 (what BackupService zips); **APPDATA\JiraCommandCenter** = grid/create JSON files; **APPDATA\MissionControl** = vault + logs.

---

## 1. Full SQLite schema (verbatim)

Created by `SqliteSchema.EnsureCreated()` — one connection, one `ExecuteNonQuery` of the whole script. Called exactly once, from `JiraInfrastructureServiceCollectionExtensions.AddJiraInfrastructure()` line 18 (DI bootstrap).

```sql
CREATE TABLE IF NOT EXISTS Profiles (
    Id TEXT PRIMARY KEY,
    ProfileName TEXT NOT NULL,
    BaseUrl TEXT NOT NULL,
    Email TEXT NULL,
    InstanceType INTEGER NOT NULL,
    CredentialKey TEXT NOT NULL,
    IsDefault INTEGER NOT NULL DEFAULT 0,
    DefaultProjectKey TEXT NOT NULL DEFAULT 'ISW',
    CreatedUtc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS SavedFilters (
    Id TEXT PRIMARY KEY,
    Name TEXT NOT NULL,
    Description TEXT NULL,
    Jql TEXT NOT NULL,
    IsFavorite INTEGER NOT NULL DEFAULT 0,
    Created TEXT NOT NULL,
    LastUsed TEXT NULL
);

CREATE TABLE IF NOT EXISTS PinnedBoards (
    Id TEXT PRIMARY KEY,
    ProfileId TEXT NOT NULL,
    BoardId INTEGER NOT NULL,
    Name TEXT NOT NULL,
    FilterId INTEGER NULL
);

CREATE TABLE IF NOT EXISTS BoardWorkspaces (
    Id TEXT PRIMARY KEY,
    ProfileId TEXT NOT NULL,
    Name TEXT NOT NULL,
    BoardIdsJson TEXT NOT NULL,
    IsDefault INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS AppSettings (
    Id INTEGER PRIMARY KEY CHECK (Id = 1),
    Json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS IssueCache (
    CacheKey TEXT PRIMARY KEY,
    Json TEXT NOT NULL,
    UpdatedUtc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS MetadataCache (
    CacheKey TEXT PRIMARY KEY,
    Json TEXT NOT NULL,
    UpdatedUtc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Teams (
    Id TEXT PRIMARY KEY,
    Name TEXT NOT NULL,
    MembersJson TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS RecentChanges (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    IssueKey TEXT NOT NULL,
    Field TEXT NOT NULL,
    OldValue TEXT NULL,
    NewValue TEXT NULL,
    DetectedUtc TEXT NOT NULL
);
```

### Schema facts that matter for the port
- **Zero indexes** are created (only implicit PK indexes). Queries filter on `ProfileId` (PinnedBoards, BoardWorkspaces) with no index — add `CREATE INDEX` in the port if you want; nothing depends on absence.
- **Zero foreign keys**, no `PRAGMA foreign_keys`, no WAL/journal settings, no busy_timeout.
- **No migration system.** Only `CREATE TABLE IF NOT EXISTS`. Adding a column to an existing DB would require manual `ALTER TABLE`; none exists. This is why settings live in a JSON blob column.
- **`RecentChanges` is dead**: no repository, no INSERT/SELECT anywhere in `src` (grep for `RecentChanges` hits only `SqliteSchema.cs`). Create it for parity or drop it.
- **Type conventions:**
  - GUID → `TEXT` via `Guid.ToString()` = "D" format, lowercase hyphenated (`3f2504e0-4f89-11d3-9a0c-0305e82c3301`). `Team.Id` is a *string* defaulting to `Guid.NewGuid().ToString("N")` = 32 hex, **no hyphens**.
  - bool → `INTEGER` 0/1; read back with `== 1`.
  - DateTime → `TEXT` via `.ToString("O", InvariantCulture)` (ISO-8601 round-trip, e.g. `2026-08-12T09:41:22.1234567Z`); always written from `DateTime.UtcNow`. Parsed with `DateTimeStyles.RoundtripKind`.
  - enums → `INTEGER` ordinal.
  - Collections → JSON `TEXT` columns.
- **Every repository opens a brand-new `SqliteConnection` per method call** and never uses transactions. `better-sqlite3` with a single long-lived `Database` handle is a strict improvement; no semantics depend on connection-per-call.

---

## 2. Repositories

All in `C:\APPS\MissionControl\src\MissionControl.Infrastructure\Jira\Storage\`. Interfaces: `C:\APPS\MissionControl\src\MissionControl.Core\Jira\Interfaces\IStorageServices.cs` and `IMetadataCacheRepository.cs`.

### 2.1 `ProfileRepository` → `Profiles`
Model `JiraConnectionProfile` (`Core\Jira\Models\JiraConnectionProfile.cs`):
`Id: Guid (new)`, `ProfileName: string ""`, `BaseUrl: string ""`, `Email: string?`, `InstanceType: JiraInstanceType`, `CredentialKey: string ""`, `IsDefault: bool`, `DefaultProjectKey: string = "ISW"`, `CreatedUtc: DateTime = UtcNow`.
`JiraInstanceType` enum (`Core\Jira\Enums\JiraInstanceType.cs`): `Cloud = 0`, `DataCenter = 1`.

| Method | SQL |
|---|---|
| `GetAllAsync()` | `SELECT Id, ProfileName, BaseUrl, Email, InstanceType, CredentialKey, IsDefault, DefaultProjectKey, CreatedUtc FROM Profiles ORDER BY ProfileName` |
| `GetByIdAsync(Guid)` | same select `WHERE Id = $id` |
| `GetDefaultAsync()` | in-memory: `GetAllAsync()` then `FirstOrDefault(IsDefault)` **else first row overall** |
| `UpsertAsync(profile)` | `INSERT ... ON CONFLICT(Id) DO UPDATE SET ProfileName, BaseUrl, Email, InstanceType, CredentialKey, IsDefault, DefaultProjectKey` — **`CreatedUtc` is deliberately not updated on conflict** |
| `DeleteAsync(Guid)` | `DELETE FROM Profiles WHERE Id = $id` |
| `SetDefaultAsync(Guid)` | two statements, no transaction: `UPDATE Profiles SET IsDefault = 0` (all rows, global) then `UPDATE Profiles SET IsDefault = 1 WHERE Id = $id` |

No JSON columns. Secret never stored here — only `CredentialKey` pointing into the secrets store.

### 2.2 `SavedFilterRepository` → `SavedFilters`
Model `SavedFilter` (`Core\Jira\Models\JiraFilterDefinition.cs:28-37`): `Id: Guid (new)`, `Name ""`, `Description: string?`, `Jql ""`, `IsFavorite: bool`, `Created: DateTime = UtcNow`, `LastUsed: DateTime?`.

- `GetAllAsync()` → `SELECT Id, Name, Description, Jql, IsFavorite, Created, LastUsed FROM SavedFilters ORDER BY Name`
- `UpsertAsync(filter)` → `INSERT ... ON CONFLICT(Id) DO UPDATE SET Name, Description, Jql, IsFavorite, LastUsed` (**`Created` not updated on conflict**)
- `DeleteAsync(Guid)` → `DELETE FROM SavedFilters WHERE Id = $id`

`Created`/`LastUsed` written with `"O"` format; `LastUsed` null → `DBNull`.

### 2.3 `PinnedBoardRepository` → `PinnedBoards`
Model `PinnedBoard` (`Core\Jira\Models\JiraBoard.cs:35-42`): `Id: Guid (new)`, `ProfileId: Guid`, `BoardId: int`, `Name: string ""`, `FilterId: int?`.

- `GetForProfileAsync(Guid profileId)` → `SELECT Id, ProfileId, BoardId, Name, FilterId FROM PinnedBoards WHERE ProfileId = $pid ORDER BY Name`
- `UpsertAsync(board)` → `INSERT ... ON CONFLICT(Id) DO UPDATE SET ProfileId, BoardId, Name, FilterId`
- `DeleteAsync(Guid)` → by `Id`

No uniqueness constraint on `(ProfileId, BoardId)` — duplicates are possible at the DB level.

### 2.4 `BoardWorkspaceRepository` → `BoardWorkspaces`
Model `BoardWorkspace` (`Core\Jira\Models\JiraBoard.cs:47-54`): `Id: Guid (new)`, `ProfileId: Guid`, `Name: string ""`, `BoardIds: List<int>`, `IsDefault: bool`.

- `GetForProfileAsync(profileId)` → `SELECT Id, ProfileId, Name, BoardIdsJson, IsDefault FROM BoardWorkspaces WHERE ProfileId = $pid ORDER BY Name`
- `UpsertAsync(ws)` → `INSERT ... ON CONFLICT(Id) DO UPDATE SET ProfileId, Name, BoardIdsJson, IsDefault`
- `DeleteAsync(Guid)`
- `SetDefaultAsync(Guid id, Guid profileId)` → `UPDATE BoardWorkspaces SET IsDefault = 0 WHERE ProfileId = $pid` then `UPDATE ... SET IsDefault = 1 WHERE Id = $id` (scoped per-profile, unlike ProfileRepository's global clear; no transaction)

**JSON column `BoardIdsJson`**: `System.Text.Json` of `List<int>` → `[1,2,3]`. Deserialize failure yields `[]` via `?? new()` (a malformed blob throws, unlike TeamRepository which try/catches).

### 2.5 `TeamRepository` → `Teams`
Model `Team` (`Core\Jira\Models\Team.cs`): `Id: string = Guid.NewGuid().ToString("N")`, `Name: string ""`, `Members: List<string>` (assignee **display names**).

- `GetAllAsync()` → `SELECT Id, Name, MembersJson FROM Teams ORDER BY Name COLLATE NOCASE`
- `GetByIdAsync(string id)` → returns `null` immediately if `id` is null/empty; else `WHERE Id = $i`
- `UpsertAsync(team)` → `INSERT ... ON CONFLICT(Id) DO UPDATE SET Name, MembersJson`
- `DeleteAsync(string id)`

**JSON column `MembersJson`**: `["Alice Smith","Bob Jones"]`; column default `'[]'`. Deserialization is wrapped in try/catch → `[]` on bad JSON.

### 2.6 `AppSettingsRepository` → `AppSettings` (single row, `Id = 1`)
- `GetAsync()` → `SELECT Json FROM AppSettings WHERE Id = 1`; if null/empty returns **a fresh default `AppSettings`** (never throws, never inserts).
- `SaveAsync(settings)` → `INSERT INTO AppSettings (Id, Json) VALUES (1, $j) ON CONFLICT(Id) DO UPDATE SET Json = excluded.Json`

Serialization: `JsonSerializer.Serialize(settings)` with **no options** → **PascalCase property names**, no indenting, `null`s included. Deserialization tolerates missing properties (they take C# field initializer defaults) and, being STJ default, is **case-insensitive-off** — i.e. property names must match PascalCase exactly. In the Node port, emit PascalCase keys to stay file-compatible with an existing DB.

Read/write pattern everywhere is **read-modify-write of the whole object** (e.g. `StarredService`, `IssueDetailsLauncher`, `SettingsViewModel`, `MyWorkViewModel`). Last writer wins; there is no locking.

### 2.7 `IssueCacheRepository` → `IssueCache`
- `UpsertManyAsync(issues)` → **no-op**, returns `Task.CompletedTask` (implemented but unused).
- `GetCachedAsync(cacheKey)` → `SELECT Json FROM IssueCache WHERE CacheKey = $k`; empty → `[]`; JSON is a serialized `List<JiraIssue>`.
- `SaveCacheAsync(cacheKey, issues)` → `INSERT INTO IssueCache (CacheKey, Json, UpdatedUtc) VALUES ($k,$j,$u) ON CONFLICT(CacheKey) DO UPDATE SET Json, UpdatedUtc`; `UpdatedUtc = DateTime.UtcNow.ToString("O")`.
- `GetLastRefreshAsync(cacheKey)` → `SELECT UpdatedUtc ...`, parsed round-trip, null if absent.
- `ClearAllAsync()` → `DELETE FROM IssueCache` (global hard-refresh button).

**Observed cache keys** (callers):
- `"dashboard:recent"` — `DashboardViewModel.cs:27`
- `` `mywork:${Jql}` `` — `MyWorkViewModel.cs:213`
- `` `timelogged:${Period}:${CustomFrom:yyyyMMdd}:${CustomTo:yyyyMMdd}` `` — `TimeLoggedViewModel.cs:164`

**Consumer semantics to preserve** (MyWork, `MyWorkViewModel.cs:207-252`): paint cached rows first → `GetLastRefreshAsync` → stale if `> 1 hour` → if fresh, re-query Jira with `updated >= lastRefresh - 2min` delta and merge by issue `Key` (case-insensitive dict) → save merged list back.

**`JiraIssue` JSON shape** (`Core\Jira\Models\JiraIssue.cs`, PascalCase): `OriginalOrder:int`, `IsStarred:bool`, `Key`, `Summary`, `IssueType`, `Status`, `StatusCategory`, `Priority`, `Assignee?`, `Reporter?`, `ProjectKey`, `Sprint?`, `Created:DateTime`, `Updated:DateTime`, `TimeSpent:TimeSpan?`, `RemainingEstimate:TimeSpan?`, `OriginalEstimate:TimeSpan?`, `EpicKey?`, `EpicName?`, `AllSprints: SprintInfo[]` (`{Name, State, StartDate?, EndDate?}`), `WorkLoggedForPeriod:TimeSpan?`, `Labels:string[]`, `Components:string[]`, `FixVersions:string[]`, `BoardNames:string[]`, `BoardIds:int[]`, `IsBlocked`, `IsCritical`, `RecentlyChanged`, `RejectReasons?`, `ChangeSummary?`, `Severity?`.
Caution for the port: STJ serializes `TimeSpan` as the **`"c"` string format** (`"1.02:03:04"`, `"00:30:00"`), and `DateTime` as ISO-8601. If you must read existing cache blobs, parse those forms.

### 2.8 `MetadataCacheRepository` → `MetadataCache`
Interface returns `CachedEntry { Json: string, UpdatedUtc: DateTime }`.

- `GetAsync(key)` → `SELECT Json, UpdatedUtc FROM MetadataCache WHERE CacheKey = $k`, null if absent.
- `SetAsync(key, json)` → upsert with `UpdatedUtc = UtcNow "O"`. Caller passes an already-serialized JSON string.
- `DeleteAsync(key)`, `ClearAllAsync()` (`DELETE FROM MetadataCache`).

**Key formats & TTLs** (stale-while-revalidate: cached value returned immediately; background refetch when older than TTL):
- `CachedJiraMetadataService` (TTL **14 days**), key = `` `meta:v10:${profileIdGuidN}:${suffix}` `` where profile is `Profile.Id.ToString("N")` or `"anon"`. Suffixes: `sugg:{fieldNameLower}`, `users:{projectKey}`, `versions:{projectKey}`, `components:{projectKey}`, `distinct:{projectKey}:{fieldNameLower}`. Payload = `string[]`. Only stored when the fresh list is non-empty.
- `CachedJiraBoardService` (TTL **30 days**), key = `` `meta:${profileIdGuidN}:boards` `` (note: **no `v10:` segment**). Payload = `JiraBoard[]` (`{Id:int, Name, Type, ProjectKey?, ProjectName?, FilterId?:int, FilterName?}`).

---

## 3. `AppSettings` — every field + default

`C:\APPS\MissionControl\src\MissionControl.Core\Jira\Models\AppSettings.cs`. Stored as one JSON blob (PascalCase keys) in `AppSettings.Json` where `Id = 1`.

| Property | Type | Default |
|---|---|---|
| `AutoRefreshEnabled` | bool | `true` |
| `RefreshIntervalSeconds` | int | `120` |
| `PauseWhenMinimized` | bool | `true` |
| `Theme` | string | `"Dark"` |
| `InAppNotifications` | bool | `true` |
| `WindowsToastNotifications` | bool | `false` |
| `CriticalOnly` | bool | `false` |
| `MuteAll` | bool | `false` |
| `IncidentDashboardUrl` | string? | `"https://hp-jira.external.hp.com/secure/Dashboard.jspa?selectPageId=82606"` |
| `IncidentDashboardId` | string? | `"82606"` |
| `DefaultProjectKey` | string | `"ISW"` |
| `DefaultProfileId` | Guid? | `null` |
| `IncidentFiltersJson` | string? | `null` — nested JSON string: map of filter id → values |
| `IncidentSummarySearch` | string? | `null` |
| `WindowLeft/Top/Width/Height` | double? | `null` |
| `WindowState` | string? | `null` |
| `SidebarWidth` | double? | `null` |
| `RecentIssueKeys` | string[] | `[]` (mirror of `RecentIssues[].Key`) |
| `RecentIssues` | `{Key, Summary}[]` | `[]` — max **10**, newest first (`IssueDetailsLauncher.cs:36-41`); shell shows first **3** |
| `StarredIssueKeys` | string[] | `[]` |
| `AccentColor` | string? | `null` |
| `KanbanWipLimits` | `Record<string, number>` | `{}` — key = column title, value = max issues; empty = no cap |
| `DashboardWidgets` | string[] | `["OpenIssues","Critical","OnHold","UpdatedToday","LoggedToday","LoggedThisWeek"]` |
| `AiEndpoint` | string? | `"https://api.githubcopilot.com/chat/completions"` |
| `AiModel` | string? | `"gpt-4o-mini"` |
| `AiCredentialKey` | string? | `null` — key into secrets store, never the token itself |
| `UseGhCopilotCli` | bool | `true` |
| `UseCopilotCliExe` | bool | `false` |
| `McpServerCommand` | string? | `null` |
| `McpServerArgs` | string[] | `[]` |
| `McpServerEnv` | `Record<string,string>` | `{}` — **contains a real secret in practice**: `SettingsViewModel.SaveMcpTokenAsync` writes `McpServerEnv["JIRA_PERSONAL_TOKEN"] = <token>` straight into the settings JSON |
| `McpTransport` | string | `"stdio"` (or `"sse"`, URL then in `McpServerCommand`) |
| `SavedQueries` | `{Name, Jql}[]` | `[]` |
| `ActiveTeamId` | string? | `null` — empty ⇒ "All assignable users" |
| `LastConfluenceSpaceKey` | string? | `null` |

Nested types: `RecentIssue { Key: string = "", Summary: string = "" }`, `SavedQuery { Name: string = "", Jql: string = "" }`.

---

## 4. File-based state (JSON / blob files)

### 4.1 `gridstate.json` — `%APPDATA%\JiraCommandCenter\gridstate.json`
`DataGridStatePersister.cs`. Shape: `Record<stateKey, Record<columnKey, ColumnEntry>>` where
```ts
type ColumnEntry = { DisplayIndex: number; Width: number; Hidden: boolean };
```
- `stateKey` values in use (from XAML `b:DataGridStatePersister.StateKey`): `BoardSearch.Boards`, `Dashboard.SprintTable`, `Filters.Results`, `Incident.All`, `Incident.Verification`, `Incident.Rejected`, `MyWork.Issues`, `RecentUpdates.Updates`, `TeamDashboard.Rows`, `TimeLogged.Issues`.
- `columnKey` = column header text, else `path:{SortMemberPath}`, else first `TextBlock`/`Run` text inside a composite header, else `col_{index}`; duplicates get `#2`, `#3` suffixes.
- Whole file cached in memory on first read; written atomically (`.tmp` → `File.Replace`/`Move`); all failures swallowed; corrupt file ⇒ `{}`.

### 4.2 `create-defaults.json` — `%APPDATA%\JiraCommandCenter\create-defaults.json`
`CreateIssueDefaultsStore.cs`. Shape: `Record<"{ProjectKey}:{IssueType}", Record<fieldId, FieldDefault>>` where
```ts
type FieldDefault = { TextValue?: string; SelectedValue?: string; SelectedItems?: string[]; DateValue?: string /* ISO */ };
```
Written **indented** (`WriteIndented = true`), non-atomic full-file rewrite under a lock. API: `Load(key)`, `Save(key, defaults)`, `Clear(key)`.

### 4.3 `create-meta-cache.json` — `%APPDATA%\JiraCommandCenter\create-meta-cache.json`
`CreateIssueMetaCache.cs`. Shape: `Record<"{ProjectKey}:{IssueType}", { SavedUtc: string /* ISO */, Meta: JiraCreateIssueMeta | null }>`. Refresh cadence: once/day (checked by the caller, `CreateIssueDialogViewModel.cs:42-70`); `ClearAll()` simply deletes the file. Not indented.

### 4.4 `credentials.dat` — `%APPDATA%\MissionControl\credentials.dat`
DPAPI-encrypted JSON. See §5.

### 4.5 Secrets directory — `%LOCALAPPDATA%\JiraCommandCenter\secrets\<key>.bin`
One DPAPI blob per key; contents = UTF-8 secret string. See §5.

### 4.6 Legacy migration list
`UserDataMigrator` copies these names from `%APPDATA%\JiraCommandCenter` → `%APPDATA%\MissionControl` on first login only, skipping any that already exist at the destination:
`starred.json`, `worklog-cache.json`, `dashboards.json`, `settings.json`, `session.json`, `filters.json`, `team.json`, `incidents.json`.
None of these are written by the current codebase — they are pure legacy-import artifacts. Optional for the port.

---

## 5. Credential storage — field lists (DPAPI → plain config file)

### 5.1 `CredentialVault` (`Infrastructure\Shared\CredentialVault.cs`)
Single file `%APPDATA%\MissionControl\credentials.dat`. Payload = `JsonSerializer.SerializeToUtf8Bytes(VaultDto)` then `ProtectedData.Protect(json, Entropy, DataProtectionScope.CurrentUser)` where `Entropy = UTF8("MissionControl.v1")`. Replace the Protect/Unprotect pair with plain read/write and you have the exact config-file shape:

```jsonc
{
  "Version": 2,                 // CurrentSchemaVersion; 1 also accepted on load (Confluence fields absent)
  "Email": "string",            // required
  "JiraBaseUrl": "string",
  "JiraPat": "string",          // secret
  "TestRailBaseUrl": "string",
  "TestRailApiKey": "string",   // secret
  "TestRailEmail": "string|null",
  "ConfluenceBaseUrl": "string|null",  // v2 only, default null
  "ConfluencePat": "string|null"       // v2 only, default null, secret
}
```
- Load: file missing → `null`; any `Version` other than 1 or 2 → throw `Unsupported vault version {n}`; empty payload → throw `Vault payload empty.`; v1 nulls are coerced to `""` for the Confluence fields.
- API surface: `Exists()`, `Load(): Credentials | null`, `Save(Credentials)` (creates parent dir), `Clear()` (delete file).
- Derived `Credentials` members (`Core\Shared\Credentials\Credentials.cs`), reimplement as getters:
  - `EffectiveTestRailEmail` = `TestRailEmail` if non-blank else `Email`
  - `IsComplete` = `Email && JiraBaseUrl && JiraPat && TestRailBaseUrl && TestRailApiKey` all non-blank
  - `HasConfluence` = `ConfluenceBaseUrl && ConfluencePat` non-blank

### 5.2 `DpapiCredentialStorageService` (`Infrastructure\Jira\Security\DpapiCredentialStorageService.cs`)
Keyed secret store, one file per key: `%LOCALAPPDATA%\JiraCommandCenter\secrets\<sanitized>.bin`, where `sanitized = key.split(invalidFileNameChars).join('_')`. Value = UTF-8 bytes of the secret, DPAPI CurrentUser, no entropy (`null`).
API: `SaveSecretAsync(key, secret)`, `GetSecretAsync(key) → string | null` (missing file → null; decrypt failure → **null, swallowed**), `DeleteSecretAsync(key)`.
Natural Node replacement: a single `secrets.json` of `Record<key, string>`, or keep one file per key.

**Key naming conventions in use:**
| Key | Producer |
|---|---|
| `"default"` | fallback `CredentialKey` for the auto-built default profile (`App.xaml.cs:201`) |
| `` `jira-${profileId}` `` | assigned when the profile has no key on token update (`SettingsViewModel.cs:191`) |
| `` `ai-${guidN}` `` | AI bearer token; key echoed into `AppSettings.AiCredentialKey` (`SettingsViewModel.cs:234-236`) |

Note the split-brain worth simplifying in the port: the *actual* Jira PAT used at runtime comes from `CredentialVault.JiraPat` (`App.xaml.cs:174-220`), while `Profiles.CredentialKey` → secrets dir is the path used by the Settings "update token" flow.

---

## 6. `StarredService` (`App\Services\StarredService.cs`)

Static/singleton, process-wide.
- State: `HashSet<string>` with **`OrdinalIgnoreCase`** comparer + `_loaded` flag + lock. In TS: `Set<string>` keyed on `key.toUpperCase()` (or a `Map` of upper→original) to preserve case-insensitive matching.
- Backing store: `AppSettings.StarredIssueKeys` via `IAppSettingsRepository`.
- `EnsureLoadedAsync()`: lazy, once; fills the set from `StarredIssueKeys`.
- `IsStarred(key)`: if not loaded, fires and forgets the load and returns set membership.
- `ToggleAsync(key)`: ensure-loaded → add-else-remove → read whole `AppSettings`, set `StarredIssueKeys = [..._set]`, save → raise `Changed(null, key)` after persistence (persist errors logged and swallowed; event still fires).
- `Apply(IEnumerable<JiraIssue>)`: stamps `issue.IsStarred = _set.has(issue.Key)` over a freshly fetched batch.
- `Changed` event is the cross-view refresh signal — in the web port this becomes a server event / client store update.

Note the read-modify-write of the *entire* settings row on each toggle; it can clobber concurrent settings writes. Worth fixing in the port (e.g. a dedicated `StarredIssues` table or a targeted JSON patch).

## 7. `BackupService` (`App\Services\BackupService.cs`)

- `BackupRoot` = `%LOCALAPPDATA%\JiraCommandCenter` — i.e. the SQLite DB, `secrets\`, `WebView2\`, and anything else under that dir. **It does not include** `%APPDATA%\JiraCommandCenter` (gridstate/create-*.json) or `%APPDATA%\MissionControl` (vault + logs).
- `Export(targetZipPath)`: throw if root missing; delete existing target; zip to `target + ".tmp"` (Optimal, no base directory); move into place; return path.
- No import/restore counterpart exists anywhere.
- Invoked from command palette: Cmd-K → `>backup` → SaveFileDialog.
- Once DPAPI is replaced by a plain config file, the backup zip becomes **plaintext-secret-bearing** — flag in the port.

---

## 8. Port checklist / gotchas

1. JSON blob columns (`AppSettings.Json`, `BoardIdsJson`, `MembersJson`, `IssueCache.Json`, `MetadataCache.Json`) must keep **PascalCase** keys for backward compat with an existing `command-center.db`.
2. Dates: write ISO-8601 UTC; .NET `"O"` includes 7 fractional digits — parsing is lenient, plain ISO output fine.
3. `TimeSpan` fields inside cached `JiraIssue` blobs use `"[d.]hh:mm:ss[.fffffff]"`, not ISO durations.
4. GUIDs: hyphenated lowercase everywhere except `Team.Id` and metadata-cache key segments, which use the 32-char no-hyphen `"N"` form.
5. `SetDefaultAsync` in both Profile and BoardWorkspace repos is two unwrapped statements — wrap in a better-sqlite3 transaction.
6. `IssueCacheRepository.UpsertManyAsync` is a no-op; `RecentChanges` is unused; `AppDataPaths.SettingsFile`/`SessionFile` are unused. Safe to drop all three in the rewrite.
7. Every setting mutation is a full read-modify-write of one row — consider a per-key settings table or an atomic JSON patch to avoid lost updates between `StarredService`, the recent-issues writer, and the settings screen.
