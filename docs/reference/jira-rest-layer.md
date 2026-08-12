# Jira Integration — Complete Technical Reference for Node/TypeScript Reimplementation

Source of truth: `C:\APPS\MissionControl\src\MissionControl.Infrastructure\Jira\Jira\*.cs`, `C:\APPS\MissionControl\src\MissionControl.Application\Jira\Services\*.cs`, `C:\APPS\MissionControl\src\MissionControl.Core\Jira\**`.

---

## 1. Auth, HTTP client, and instance-type handling

**File:** `JiraHttpClientFactory.cs`

### Base URL normalization
```
url = profile.BaseUrl.trim()
if (url && !url.endsWith('/')) url += '/'
```
All request paths are **relative** (no leading slash) and resolved against this base — e.g. base `https://hp-jira.external.hp.com/` + `rest/api/2/search`.

### API version selection
```ts
apiPrefix(instance) = instance === Cloud ? "rest/api/3" : "rest/api/2"
agilePrefix()       = "rest/agile/1.0"
// greenhopper paths are hardcoded: "rest/greenhopper/1.0/..."
```
`JiraInstanceType` enum: `Cloud | DataCenter`.

### Auth header
| Instance | Header |
|---|---|
| `Cloud` | `Authorization: Basic base64(utf8(`${profile.Email}:${secret}`))` — secret = API token |
| `DataCenter` | `Authorization: Bearer ${secret}` — secret = PAT |

### Other client settings
- `Accept: application/json`.
- Request timeout **60 s**.
- POST/PUT bodies: `Content-Type: application/json; charset=utf-8`.
- Throws `"No active Jira session."` if `session.Profile` or `session.Secret` is missing.

### Other Cloud-vs-DC differences (beyond version + auth)
1. **Comment body format** (comments, worklogs, transition-with-data):
   - Cloud → ADF: `{ type:"doc", version:1, content:[{ type:"paragraph", content:[{ type:"text", text: <body> }] }] }`
   - DataCenter → plain string.
2. `GetAssignableUsersAsync` always sends `username=.` "defensively" for DC builds that reject a missing username (Cloud wants `query=`; the code does **not** send `query`).
3. `MapUser` accepts `accountId` (Cloud) OR `key`/`name` (DC) as the identity.
4. Worklog author matching tolerates accountId (Cloud) or displayName (DC) — see §8.

### Session (`JiraSession.cs`)
Process-lifetime singleton: `{ Profile, Secret, CurrentUser, IsConnected, Activate(profile, secret, user), Clear(), Changed event }`. `IsConnected = Profile != null && Secret non-empty`. Nearly every service early-returns an empty result when `!IsConnected` (write ops throw `"No active Jira session."`).

### Error translation (`JiraIssueService.EnsureSuccess`)
```
401 | 403  -> UnauthorizedAccessException("You do not have permission to view this Jira resource.")
400      -> InvalidOperationException(extractErrorMessage(body) ?? "Bad request.")
other    -> InvalidOperationException(`Jira request failed: ${status} ${reason}`)
```
`extractErrorMessage`: parse body, join `errorMessages[]` (strings) plus `errors` object entries formatted as `"{name}: {value}"`, joined by `\n`.

---

## 2. Every Jira REST endpoint called

`{P}` = `rest/api/3` (Cloud) or `rest/api/2` (DC). `{A}` = `rest/agile/1.0`.

### 2.1 Auth / identity
| Method | Path | Notes |
|---|---|---|
| GET | `{P}/myself` | TestConnection (profile+secret directly, before session activation) and GetCurrentUser. Response → `MapUser`. |

Reads: `accountId`, `key`, `name`, `displayName`, `emailAddress`, `avatarUrls["48x48"]`, `active`.

### 2.2 Issue search
| Method | Path | Body |
|---|---|---|
| POST | `{P}/search` | `{ jql, startAt, maxResults, fields: string[] }` |

Response fields read: `issues[]` (→ `MapIssue`), `startAt`, `maxResults`, `total`. Missing values fall back to the request's `startAt`/`maxResults` and `items.length`.

**Field list** (`BaseFields`, verbatim):
```
summary, issuetype, status, priority, assignee, reporter,
project, created, updated, timespent, timeestimate, timeoriginalestimate,
parent, epic, customfield_10014, customfield_10008, customfield_10100,
customfield_10000, customfield_10001, customfield_10006,
labels, components, fixVersions, "Reject Reasons", "Severity"
```
Plus dynamically discovered ids appended once (cached in `_cachedFields`, mutex-guarded; `ResetFieldCache()` clears): Sprint field id, Severity field id, Reject Reasons field id, custom "Priority" field id if exists.

**Pagination** (`SearchAllAsync`): page size **100**, loops while `all.length < hardCap && result.hasMore`, `startAt += items.length`. `hasMore = startAt + items.length < total`.

### 2.3 Field discovery
| Method | Path | Notes |
|---|---|---|
| GET | `{P}/field` | Array; reads `id` + `name`. |

Two consumers:
- `DiscoverCustomFieldIdsAsync`: matches display names case-insensitively — `"Sprint"` → sprintId; `"Severity"` → `SeverityFieldId`; `"Reject Reasons"` → `RejectReasonsFieldId`; `"Priority"` **only if id starts with `customfield_`** → `PriorityFieldId`. First match wins.
- `LoadFieldMapAsync`: case-insensitive `Map<name, id>` cached for process lifetime.

### 2.4 Issue details
| Method | Path | Query |
|---|---|---|
| GET | `{P}/issue/{urlEncode(issueKey)}` | `fields=*all&expand=renderedFields,names,changelog` |

Reads: `fields.*` (→ `MapIssue`, `ExtractAllFields`, `ExtractParent`), `names` (field-id → display label map), `renderedFields.description` (HTML), `fields.description`, `fields.comment.comments[]`, `fields.worklog.worklogs[]`, `changelog.histories[]` → `{ created, author.displayName, items[].field, items[].fromString, items[].toString }`, `fields.issuelinks[]`.

Also nested call to transitions list (2.6) to fill `Transitions`.

### 2.5 Epic name enrichment
GET `{P}/issue/{epicKey}?fields=summary`. Reads `fields.summary`. Concurrency cap **8**. Static process LRU `_epicNameCache` cap **500** (move-to-front). Failures silently ignored.

### 2.6 Transitions
| Method | Path | Query / Body |
|---|---|---|
| GET | `{P}/issue/{key}/transitions` | — |
| GET | `{P}/issue/{key}/transitions` | `?expand=transitions.fields` (transition screen) |
| POST | `{P}/issue/{key}/transitions` | `{ transition: { id } }` |
| POST | `{P}/issue/{key}/transitions` | `{ transition: { id }, fields: {...}, update?: {...} }` |

List reads `transitions[].id`, `.name`, `.to.name` → `JiraTransition`.

Screen reads, for transition whose `id === transitionId`, `fields` object; per field: key = fieldId, `name` (default = key), `required` (bool), `schema.type`, `schema.items`, `allowedValues[]` → `value ?? name` → `JiraTransitionField`.

`PerformTransitionWithDataAsync` payload rules:
- Copy caller-provided `fields`; **delete `worklog`** from `fields` (Jira rejects it there).
- If `assignee` provided: `fields.assignee = { name: assignee }` (DC-style username).
- If `comment` provided: `update.comment = [{ add: <commentBody> }]` — ADF on Cloud, `{ body: "text" }` on DC.
- If `timeSpent` provided: `update.worklog = [{ add: { timeSpent } }]` (Jira time string, e.g. `"3h"`, `"1d 2h"`).
- `update` key omitted when both absent.

### 2.7 Comments & labels
| Method | Path | Body |
|---|---|---|
| POST | `{P}/issue/{key}/comment` | Cloud: `{ body: ADF }`; DC: `{ body: "text" }` |
| PUT | `{P}/issue/{key}` | `{ update: { labels: [ { add: "<label>" } ] } }` |

Both no-op (return silently) on empty input.

### 2.8 Worklogs
| Method | Path | Query | Body |
|---|---|---|---|
| GET | `{P}/issue/{key}/worklog` | — | — |
| POST | `{P}/issue/{key}/worklog` | adjustEstimate below | `{ timeSpentSeconds, comment, started }` |

GET reads `worklogs[]` → `MapWorklog`.

POST rules:
- `timeSpentSeconds = round(totalSeconds)`; **throws if < 60**.
- `comment`: ADF on Cloud, plain string on DC, `null` when blank.
- `started` format: `yyyy-MM-ddTHH:mm:ss.fffzzz` with **offset colon stripped** → `2026-05-04T08:23:45.123+0300`. UTC converted to local first.
- adjustEstimate: `Auto` → none; `Leave` → `?adjustEstimate=leave`; `New` → `?adjustEstimate=new&newEstimate={enc}` (throws if missing); `Manual` → `?adjustEstimate=manual&reduceBy={enc}` (throws if missing).
- Response body → `MapWorklog`. 401/403 → `"You do not have permission to log work on this issue."`

### 2.9 Boards & sprints
| Method | Path | Query |
|---|---|---|
| GET | `rest/greenhopper/1.0/rapidviews/list` | — |
| GET | `{A}/board` | `?startAt={n}&maxResults=50` |
| GET | `{A}/board/{boardId}/sprint` | `?state=active` |
| GET | `{A}/board/{boardId}/issue` | `?maxResults=100[&jql={urlEncoded}]` |

`GetBoardsAsync` calls **both** greenhopper and agile, merging into `Map<id, board>` (greenhopper wins on collision), sorted by name ci. Returns `BoardLoadResult { Boards, FromGreenhopper, FromAgile, GreenhopperError, AgileError }`. Errors like `"greenhopper 403"`, `"agile 401"`, `"greenhopper: no views array"`.

- Greenhopper mapping (`views[]`): `id` (int-or-numeric-string), `name`, `sprintSupportEnabled === true ? "scrum" : "kanban"`, `filter.id` / `filter.name`, else `savedFilterId`.
- Agile mapping (`values[]`): `id`, `name`, `type`, `location.projectKey`, `location.projectName`, `filter.id`, `filter.name`.
- Agile pagination: page 50; stops when `values` missing, batch empty, `isLast === true`, or `batch.length < 50`.
- Sprints (`values[]`): `id`, `name`, `state`, `originBoardId`, `startDate`, `endDate` → `JiraSprint`.
- Board issues: reads `issues[]` → `MapIssue`. **Returns empty array on any non-2xx** (no throw).

### 2.10 Quick filters (Greenhopper probe chain)
`GetQuickFiltersAsync(rapidViewId)` tries **in order**, first result with non-empty `quickFilters`:
```
rest/greenhopper/1.0/rapidviewconfig/quickfilters?rapidViewId={id}
rest/greenhopper/1.0/rapidview/{id}
rest/greenhopper/1.0/rapidviews/list
rest/greenhopper/1.0/xboard/config.json?rapidViewId={id}
rest/greenhopper/1.0/rapidviewconfig/editmodel?rapidViewId={id}
```
Scan: walk whole JSON tree; any object property named `quickFilters` (ci) that is an array → each object element with string `name` → `{ Id: number(id) || 0, Name, Query: query ?? "" }`.

### 2.11 Dashboards
| Method | Path | Query |
|---|---|---|
| GET | `{P}/dashboard` | `?startAt={n}&maxResults=50` |
| GET | `{P}/dashboard/{urlEncode(id)}` | — |
| GET | `{P}/dashboard/{urlEncode(id)}/gadget` | — |

- List reads `dashboards[]` and `total`; loops until `batch.length === 0 || startAt >= total`; breaks on any non-2xx.
- Summary mapping: `id` (string), `name`, `owner.displayName`, `view` → `ViewUrl`, `isFavourite`.
- Gadget mapping: `id` (**raw JSON text**), `title`, `moduleKey`; `Supported` hardcoded **false**. Gadget call try/caught and skipped if unavailable.

### 2.12 Create issue
| Method | Path | Query / Body |
|---|---|---|
| GET | `{P}/issue/createmeta` | `?projectKeys={k}&issuetypeNames={t}&expand=projects.issuetypes.fields` (Path A, legacy) |
| GET | `{P}/issuetype` | — (resolve issue type name → numeric id) |
| GET | `{P}/issue/createmeta/{projectKey}/issuetypes/{issueTypeId}` | (Path B, paged; only if A returned 0 fields) |
| POST | `{P}/issue` | `{ fields: { ...caller, project: { key }, issuetype: { name } } }` |

- Legacy parse: `projects[].issuetypes[].fields` → each object property (key = fieldId).
- Paged parse: `values[]`, each element's `fieldId`.
- Field mapping: `FieldId`, `DisplayName = name ?? fieldId`, `Required = required === true`, `SchemaType = schema.type ?? ""`, `AllowedValues` = per element, string itself or first present of `value`/`name`/`displayName`.
- POST response: reads `key`, returns it (or `""`). Non-2xx throws ``Jira rejected the issue: {status} {reason} — {body truncated to 400}``.

### 2.13 Metadata
| Method | Path | Query | Reads |
|---|---|---|---|
| GET | `{P}/project` | — | `[].key` |
| GET | `{P}/issuetype` | — | `[].name` |
| GET | `{P}/status` | — | `[].name` |
| GET | `{P}/priority` | — | `[].name` |
| GET | `{P}/resolution` | — | `[].name` |
| GET | `{P}/project/{key}/versions` | — | `[].name` |
| GET | `{P}/project/{key}/components` | — | `[].name` |
| GET | `{P}/user/assignable/search` | `?project={k}&username=.&startAt={n}&maxResults=50` | `[].displayName` |
| GET | `{P}/jql/autocompletedata/suggestions` | `?fieldName={f}[&fieldValue={q}][&predicateName=project&predicateValue={defaultProjectKey}]` | `results[].value` |

- `FetchListAsync` results: distinct then ordinal sort.
- Versions/components: distinct then ci sort. Empty array on any failure.
- Assignable users: page 50, hard cap **1000**, max **25** iterations, **10 s** timeout, breaks when `added === 0 || added < 50`; distinct + ci sort.
- Suggestions: distinct, no sort.

---

## 3. Domain models

### JiraIssue
```ts
interface SprintInfo { Name: string; State: string; StartDate?: Date; EndDate?: Date }

interface JiraIssue {
  OriginalOrder: number;          // load order, restores position when unstarred
  IsStarred: boolean;
  Key: string;
  Summary: string;
  IssueType: string;
  Status: string;
  StatusCategory: string;         // status.statusCategory.key
  Priority: string;
  Assignee?: string;              // displayName
  Reporter?: string;
  ProjectKey: string;
  Sprint?: string;                // resolved active sprint name
  Created: Date;
  Updated: Date;
  TimeSpent?: TimeSpan;           // timespent seconds
  RemainingEstimate?: TimeSpan;   // timeestimate
  OriginalEstimate?: TimeSpan;    // timeoriginalestimate
  EpicKey?: string;
  EpicName?: string;
  AllSprints: SprintInfo[];
  WorkLoggedForPeriod?: TimeSpan; // filled by TimeLoggedService
  Labels: string[];
  Components: string[];
  FixVersions: string[];
  BoardNames: string[];           // populated by callers, not mapper
  BoardIds: number[];
  IsBlocked: boolean;
  IsCritical: boolean;
  RecentlyChanged: boolean;
  RejectReasons?: string;
  ChangeSummary?: string;         // transient, recent-updates feed
  Severity?: string;
}
```

### JiraIssueDetails
```ts
interface JiraIssueDetails {
  Issue: JiraIssue;
  Description: string;              // fields.description (string, or JSON stringified if ADF)
  DescriptionHtml?: string;         // renderedFields.description
  Comments: JiraComment[];
  Worklogs: JiraWorklog[];
  Transitions: JiraTransition[];
  AllFields: Array<{ key: string; value: string }>;
  BrowseUrl?: string;               // `${baseUrl w/o trailing /}/browse/${key}`
  ParentKey?: string;
  ParentSummary?: string;
  ParentFieldLabel?: string;        // e.g. "Parent", "IM: Parent Issue"
  Timeline: JiraTimelineEvent[];
}
interface JiraTimelineEvent { When: Date; Author: string; Kind: "change"|"comment"|"worklog"; Summary: string }
interface JiraTransition { Id: string; Name: string; ToStatus?: string }
interface JiraTransitionField { Id: string; Name: string; Required: boolean; SchemaType: string; ItemType?: string; AllowedValues: string[] }
interface JiraComment { Author: string; Created: Date; Body: string }
```

### Boards / dashboards / worklog / user / filters / createmeta
```ts
interface JiraBoard { Id: number; Name: string; Type: string; ProjectKey?: string; ProjectName?: string; FilterId?: number; FilterName?: string }
interface JiraSprint { Id: number; Name: string; State: string; StartDate?: Date; EndDate?: Date; OriginBoardId?: number }
interface PinnedBoard { Id: Guid; ProfileId: Guid; BoardId: number; Name: string; FilterId?: number }
interface BoardWorkspace { Id: Guid; ProfileId: Guid; Name: string; BoardIds: number[]; IsDefault: boolean }
interface JiraQuickFilter { Id: number; Name: string; Query: string }
interface BoardLoadResult { Boards: JiraBoard[]; FromGreenhopper: number; FromAgile: number; GreenhopperError?: string; AgileError?: string }
interface JiraDashboardSummary { Id: string; Name: string; Owner?: string; ViewUrl?: string; IsFavourite: boolean }
interface JiraDashboardDetails { Summary: JiraDashboardSummary; Gadgets: JiraDashboardGadget[] }
interface JiraDashboardGadget { Id: string; Title: string; ModuleKey: string; Supported: boolean /* always false */ }
interface JiraWorklog { Id: string; IssueKey: string; Author: string; AuthorAccountId?: string; Started: Date; TimeSpent: TimeSpan; Comment?: string }
interface JiraUser { AccountId: string; DisplayName: string; EmailAddress?: string; AvatarUrl?: string; Active: boolean }

enum JiraFilterControlType { QuickButton, Dropdown, MultiSelectDropdown, TextSearch, DatePicker, UserPicker, JqlOnly }
interface JiraFilterDefinition {
  Id: string; DisplayName: string; ControlType: JiraFilterControlType;
  JiraFieldName?: string; JiraFieldId?: string; JqlTemplate?: string;
  IsQuickFilter: boolean; SupportsMultiSelect: boolean; DisplayOrder: number; GroupName?: string;
}
interface SavedFilter { Id: Guid; Name: string; Description?: string; Jql: string; IsFavorite: boolean; Created: Date; LastUsed?: Date }
interface JiraFilterSelection { FilterId: string; Values: string[] }
interface JiraCreateFieldMeta { FieldId: string; DisplayName: string; Required: boolean; SchemaType: string; AllowedValues: string[] }
interface JiraCreateIssueMeta { ProjectKey: string; IssueType: string; Fields: JiraCreateFieldMeta[] }
interface PagedResult<T> { Items: T[]; StartAt: number; MaxResults: number; Total: number; HasMore /* StartAt + Items.length < Total */ }
interface Team { Id: string /* Guid "N" */; Name: string; Members: string[] /* display names */ }
```

### Report/snapshot models
```ts
interface TimeLoggedReport { Issues: JiraIssue[]; Total: TimeSpan; FromUtc: Date; ToUtc: Date; DailyByIssue: DailyLogEntry[]; AvailableSprints: string[] }
type DailyLogEntry = { Day: Date; IssueKey: string; IssueSummary: string; TimeSpent: TimeSpan };
interface DashboardSnapshot { OpenIssues: number; CriticalIncidents: number; Blocked: number; UpdatedToday: number; TimeLoggedToday: TimeSpan; TimeLoggedThisWeek: TimeSpan; RecentlyUpdated: JiraIssue[]; LoadedAtUtc: Date }
```

---

## 4. JSON → domain mapping details (`JiraJsonMapper.cs`)

Static mutable state (set once by field discovery): `SeverityFieldId`, `RejectReasonsFieldId`, `PriorityFieldId`.

### MapIssue
- `Key` ← `el.key`; everything else from `el.fields`.
- `Priority` ← `fields.priority.name`, else `fields[PriorityFieldId]` via `ReadDisplayValue`, else `""`.
- `StatusCategory` ← `fields.status.statusCategory.key`.
- `TimeSpent/RemainingEstimate/OriginalEstimate` ← numeric seconds.
- `RejectReasons` ← `fields["Reject Reasons"]` (direct label key) else `fields[RejectReasonsFieldId]`. Same for `Severity`.
- **Epic resolution order:** (1) `fields.epic.key`; (2) `fields.parent` — take `parent.key` **only if** parent's `fields.issuetype.name` missing or equals `"Epic"` (then `EpicName = parent.fields.summary`); (3) first of `customfield_10014, customfield_10008, customfield_10100, customfield_10000, customfield_10001, customfield_10006` whose string value matches `/^[A-Z][A-Z0-9_]*-\d+$/`.
- **Flags:** `IsBlocked = status === "Blocked" (ci) || labels contains "blocked" (ci)`; `IsCritical = priority is "Critical" or "Highest" (ci)`.

### Sprint extraction
`TryFindSprint`: (a) top-level `fields.sprint` → first object with `name`; (b) scan every `customfield_*` **array** property:
- Object elements accepted only if they have any of `boardId`, `state`, `startDate`, `goal` (guard against Components/FixVersions). Prefer element with `state === "active"` (ci); fall back to first non-active.
- String elements: must contain `"Sprint"`; parse `name=` up to next `,`; active if text after `state=` starts with `ACTIVE` (ci).
Result: `active ?? closedFallback`.

`ExtractAllSprints` → `SprintInfo[]` deduped by name (ci), reading object form (`name`, `state`, `startDate`, `endDate`) and legacy Greenhopper string form (`key=` values up to `,` or `]`).

### Date parsing
Jira emits offsets without colon (`2026-05-04T08:23:45.123+0000`). Normalize `/([+-]\d{2})(\d{2})$/` → `$1:$2` before `new Date()`.

### AllFields extraction (details view)
- Skipped: `summary, status, priority, issuetype, assignee, reporter, project, created, updated, labels, components, fixVersions, comment, worklog, description, watches, votes, progress, aggregateprogress, timetracking, parent`.
- Label = `names[fieldId] ?? fieldId`.
- Hidden labels (substring, ci): contains `Development`, `Tasks Checklist`, `To Do List Proxy`, `Validation List`; or equals `Epic Link`.
- Value formatting: string → itself; number/bool → raw; object → first of `displayName`, `name`, `value`, `key`; array → comma-joined non-empty formatted items.
- Dropped if blank or "Java bean": contains `com.atlassian`, contains `summaryBean=`, or (starts with `[` and contains `@` and `=`).
- Sorted by label, ci.

### Parent extraction (`ExtractParent`) — lookup order
1. `fields.parent.key` (label `"Parent"`, summary from `parent.fields.summary`).
2. Any `customfield_*` whose display label contains `"parent"` (ci) → `TryReadIssueRef`.
3. `fields.issuelinks[]` where `type.name`/`type.inward`/`type.outward` contains `"parent"` (ci) → `inwardIssue.key` (label = inward) or `outwardIssue.key` (label = outward).
4. `customfield_10006`, `customfield_10008`, `customfield_10014` as plain string matching `/^[A-Z][A-Z0-9_]+-\d+$/`; then any custom field whose label contains `"epic"` (ci).
Else nulls.

`TryReadIssueRef` accepts: object with `key`; plain string matching the key regex; object with `value` (recursed); array (first successful element).

### Timeline construction (`BuildTimeline`)
Merged, sorted ascending by `When`:
- changelog history items → `{ Kind:"change", Summary: `${field}: ${from || "—"} → ${to || "—"}` }`.
- comments → `{ Kind:"comment", Summary: body truncated 280 chars + "…" }`.
- worklogs → `{ Kind:"worklog", Summary: `+${hours:0.##}h` + (comment ? ` — ${comment}` : "") }`.

---

## 5. Caching behavior

### CachedJiraBoardService
- Decorates only **`GetBoardsAsync`**. Sprints/board-issues/quick-filters pass through — never cached.
- Cache key: `` `meta:${profileId "N"}:boards` `` (`"anon"` if no profile).
- Stored value: `JSON.stringify(JiraBoard[])`.
- TTL **30 days**, stale-while-revalidate: existing entry returned immediately; if older than TTL, fire-and-forget background refetch+store.
- Cached returns fabricate `BoardLoadResult { FromGreenhopper: boards.length, FromAgile: 0, GreenhopperError: "served from cache (refresh queued)" | "served from cache" }`.
- Writes only when fresh result non-empty.

### CachedJiraMetadataService
- Key prefix: `` `meta:v10:${profileId "N"}:${suffix}` `` — bumping `v10` is manual global invalidation.
- TTL **14 days**, same stale-while-revalidate; writes only non-empty.
- Cached suffixes: `projects`, `issuetypes`, `statuses`, `priorities`, `sugg:{fieldLower}`, `users:{projectKey}`, `versions:{projectKey}`, `components:{projectKey}`, `distinct:{projectKey}:{fieldLower}`.
- **Not cached:** suggestions with non-empty typed query; `ResolveJqlFieldAsync`.

### Store & invalidation
- Backing `MetadataCache(CacheKey PK, Json, UpdatedUtc)`; upsert.
- Global hard refresh: clear IssueCache + MetadataCache + `ResetFieldCache()`.
- Settings screen also clears metadata cache.

### In-memory caches
- `_cachedFields` (search field list, mutex, reset via ResetFieldCache).
- `_epicNameCache` LRU cap 500.
- `_fieldIdMap` name→id, loaded once, never expires.
- Mapper static field ids.

---

## 6. JQL construction

### JqlEscape
```
Quote(value):
  null or empty -> "\"\""
  else: '"' + each char: '\\'/'"' -> escaped; c < 0x20 -> dropped; else c
        + '"'
```

### JqlBuilder
`BuildFromFilters(definitions, selections, defaultProjectKey)`:
1. Index definitions by Id (ci).
2. If `defaultProjectKey` non-blank, first clause `project = ${defaultProjectKey}` (**unquoted, unescaped**).
3. For each selection, look up definition (skip unknown), build fragment, append non-empty.
4. Join with `" AND "`.

`BuildFragment(def, sel)`:
- `sel.Values.length === 0` and not QuickButton → `""`.
- `QuickButton` → `JqlTemplate` verbatim. Values ignored.
- No template: no `JiraFieldName` → `""`; else `BuildDefault`.
- Template contains `{values}` → replace with comma-joined quoted values (`", "`).
- Template contains `{value}` → replace with quoted `Values[0]`.
- Otherwise template verbatim.

`BuildDefault(field, values, multi)`:
```
quoted = field.startsWith('"') ? field : `"${field}"`
if (values.length === 1 && !multi) return `${quoted} = ${quote(values[0])}`
return `${quoted} in (${values.map(quote).join(", ")})`
```
`SupportsMultiSelect` true for every MultiSelectDropdown → those always emit `in (...)`.

`QuoteValue` (JqlBuilder's copy — does **not** strip control chars):
```
empty -> "\"\""
else  -> '"' + v.replace(/\\/g,'\\\\').replace(/"/g,'\\"') + '"'
```

`AppendBoardScope(baseJql, boardIds)` → returns input unchanged (dead code; boards load via `/board/{id}/issue`).

### Incident dashboard JQL assembly (exact ordering)
1. Base = `BuildFromFilters(defs, selectionsExcluding("reporter","assignee","reported-by-me","my-issues"), project)`.
2. If no `"issuetype"` (ci) in string: `+= " AND issuetype in (Incident, Bug, Defect)"`.
3. `+= " AND " + personClause` where personClause = `GetReporterClause()` ?? `"(reporter = currentUser() OR assignee = currentUser())"`.
4. If no `"status"` (ci) and no `status` selection: `+= " AND statusCategory != Done"`.
5. `+= " AND status not in (Rejected, Verification)"`.
6. `+= " ORDER BY priority DESC, updated DESC"`.
Main search: `startAt=0, maxResults=200`.

`GetReporterClause()` — people from `reporter` + `assignee` selections; `meAlias` if `reported-by-me` or `my-issues` selected. Null if nothing; else:
```
"(" + [ "reporter = currentUser()", "assignee = currentUser()" (if meAlias),
        `reporter in (${quoted})`, `assignee in (${quoted})` (if people) ].join(" OR ") + ")"
```
`QuoteList` = `values.map(v => '"' + v.replace(/"/g,'\\"') + '"').join(",")` (comma, no space).

Sticky panels: `BuildStickyJql(project, status, clause)` →
```
project = {project} AND issuetype in (Incident, Bug, Defect) AND status = "{status}"[ AND {clause}] ORDER BY priority DESC, updated DESC
```
statuses `"Verification"` and `"Rejected"`, each `startAt=0, maxResults=200`.

### JQL field-reference resolution (`ResolveJqlFieldAsync`)
```
id = resolveFieldId(displayName)
id == null                     -> `"${displayName}"`
id.startsWith("customfield_")  -> `cf[${id.slice(12)}]`     // NOT customfield_NNNN — 400s in JQL
else                           -> id
```
`resolveFieldId`: exact map hit → normalized (strip non-alphanumerics, lowercase) → alias table → null.

**Alias table (keys lowercased):**
```
"wt group"                  -> "WT"
"program group"             -> "Program"
"submitting team group"     -> "Submitting Team"
"sw ee teams group"         -> "SW EE Team"
"phase detected"            -> "Found in Project Phase"
"defect status"             -> "Status"
"priority&severity"         -> "Severity"
"priority & severity"       -> "Severity"
"bugs mapping"              -> "Labels"
"automation statistics"     -> "Automation"
"bug classification"        -> "Bug Resolution"
"bug classification & reason" -> "Bug Resolution"
"regression vs feature"     -> "Regression Type"
```

### Distinct-field JQL (`GetDistinctIssueFieldAsync`)
```
jql = `project = ${projectKey} AND ${jqlField} is not EMPTY`
```
`jqlField` = `cf[NNNN]` if customfield, else resolved id, else `"${fieldName}"`. Requested `fields: [fieldId ?? fieldName]`. Page 200, 45 s timeout, `hardCap = max(maxIssues, 200)`, loops until `batch < 200 || startAt >= total`. Value extraction: number (strip trailing `.0`), string (if contains `name=`, take up to next `,` or `]`), object (first of `value`/`name`/`displayName`, else `fields.summary`, else `key`), array (recurse). Result: ci-distinct, ci-sorted.

---

## 7. IncidentFilterCatalog — verbatim definitions

`DisplayOrder` increments 0,1,2,… in exact order below.

### Quick filters (`QuickButton`, `IsQuickFilter = true`; template verbatim)
| Id | DisplayName | JqlTemplate | GroupName |
|---|---|---|---|
| `automation-infra` | `!Automation Infra` | `labels != automation-infra` | Quick |
| `veracode` | `!VeraCode` | `labels != veracode` | Quick |
| `dev-bug-stats` | `Dev Bug Statistics` | `issuetype = Bug AND "Bug Type" = Dev` | Quick |
| `qa-bug-stats` | `QA bug Statistic` | `issuetype = Bug AND "Bug Type" = QA` | Quick |
| `my-issues` | `My Issues` | `assignee = currentUser()` | Quick |
| `reported-by-me` | `Reported by me` | `reporter = currentUser()` | Quick |
| `no-clones` | `No Clones` | `issuetype != Clone` | Quick |
| `unassigned` | `Unassigned` | `assignee is EMPTY` | Quick |
| `incident` | `Incident` | `issuetype = Incident` | Type |
| `sw-bug` | `SW Bug` | `issuetype = Bug` | Type |
| `rc` | `RC` | `issuetype = RC` | Type |
| `investigation` | `Investigation` | `issuetype = Investigation` | Type |
| `open` | `Open` | `status = Open` | Status |
| `delivered` | `Delivered` | `status = Delivered` | Status |
| `verification` | `Verification` | `status = Verification` | Status |
| `rejected` | `Rejected` | `status = Rejected` | Status |
| `pending-decision` | `Pending Decision` | `status = "Pending Decision"` | Status |
| `review-approved` | `Review Approved` | `status = "Review Approved"` | Status |
| `closed` | `Closed` | `status = Closed` | Status |
| `done` | `Done` | `statusCategory = Done` | Status |
| `s3` | `S3` | `priority = S3` | Severity |
| `s4-5` | `S4/5` | `priority in (S4, S5)` | Severity |
| `s6` | `S6` | `priority = S6` | Severity |
| `future-platform` | `Future Platform` | `labels = future-platform` | Quick |
| `not-investigation` | `Not Investigation` | `issuetype != Investigation` | Quick |
| `clones-closed-links` | `Clones with CLOSED Links` | `issuetype = Clone AND issueLinkType = "is cloned by"` | Quick |
| `performance-bugs` | `Performance Bugs` | `labels = performance` | Quick |
| `in-progress` | `In Progress` | `status = "In Progress"` | Quick |
| `feature-incident` | `Feature incident` | `labels = feature-incident` | Quick |
| `reopen` | `Reopen` | `status = Reopened` | Quick |

### Dropdown filters (`GroupName = "Fields"`, no template → `BuildDefault`; `SupportsMultiSelect = (type === MultiSelectDropdown)`)
| Id | DisplayName | JiraFieldName (verbatim, incl. embedded quotes) | ControlType |
|---|---|---|---|
| `program` | Program | `Program` | MultiSelectDropdown |
| `fix-version` | Fix Version/s | `fixVersion` | MultiSelectDropdown |
| `module-branch` | Deliver to Module Branch | `"Module Branch"` | MultiSelectDropdown |
| `merged-build` | Merged in Build Num | `"Merged in Build Num"` | MultiSelectDropdown |
| `sw-ee-team` | SW EE Team | `"SW EE Team"` | MultiSelectDropdown |
| `wt` | WT | `WT` | MultiSelectDropdown |
| `assignee` | Assignee | `assignee` | **UserPicker** (multi=false) |
| `reporter` | Reporter | `reporter` | **UserPicker** (multi=false) |
| `sprint` | Sprint | `sprint` | MultiSelectDropdown |
| `reject-reasons` | Reject Reasons | `"Reject Reasons"` | MultiSelectDropdown |
| `epic-link` | Epic Link | `"Epic Link"` | MultiSelectDropdown |
| `classification` | Classification | `Classification` | MultiSelectDropdown |
| `labels` | Labels | `labels` | MultiSelectDropdown |
| `resolution` | Resolution | `resolution` | MultiSelectDropdown |
| `affects-version` | Affects Version/s | `affectedVersion` | MultiSelectDropdown |
| `primary-developer` | Primary Developer | `"Primary Developer"` | MultiSelectDropdown |
| `primary-tester` | Primary tester | `"Primary Tester"` | MultiSelectDropdown |
| `created` | Created | `created` | **DatePicker** (multi=false) |
| `priority` | Priority | `priority` | MultiSelectDropdown |
| `severity` | Severity | `Severity` | MultiSelectDropdown |
| `regression-vs-feature` | Regression VS Feature | `"Regression VS Feature"` | MultiSelectDropdown |
| `bug-classification` | Bug classification & Reason | `"Bug Classification"` | MultiSelectDropdown |
| `sw-ee-teams-group` | SW EE Teams group | `"SW EE Teams Group"` | MultiSelectDropdown |
| `program-group` | Program Group | `"Program Group"` | MultiSelectDropdown |
| `defect-status` | Defect Status | `"Defect Status"` | MultiSelectDropdown |
| `phase-detected` | Phase Detected | `"Phase Detected"` | MultiSelectDropdown |
| `priority-severity` | Priority&Severity | `"Priority&Severity"` | MultiSelectDropdown |
| `submitting-team-group` | Submitting Team Group | `"Submitting Team Group"` | MultiSelectDropdown |
| `bugs-mapping` | Bugs Mapping | `"Bugs Mapping"` | MultiSelectDropdown |
| `wt-group` | WT Group | `"WT Group"` | MultiSelectDropdown |
| `automation-statistics` | Automation statistics | `"Automation Statistics"` | MultiSelectDropdown |
| `environment-affected` | Environment Affected | `"Environment Affected"` | MultiSelectDropdown |

### Text search (last entry)
```
Id: "summary", DisplayName: "Summary", ControlType: TextSearch,
JiraFieldName: "summary", JqlTemplate: "summary ~ {value}", GroupName: "Search"
```

---

## 8. Orchestration services

### DashboardAggregator
`project = session.Profile?.DefaultProjectKey ?? "ISW"`.
```
sprintScope = `project = ${project} AND assignee = currentUser() AND Sprint in openSprints()`
```
Five **parallel** searches, each `startAt=0`:
| KPI | JQL | maxResults | Value read |
|---|---|---|---|
| OpenIssues | `{sprintScope} AND statusCategory != Done` | 1 | `Total` |
| CriticalIncidents | `{sprintScope} AND issuetype in (Incident, Bug, Defect) AND priority in (Critical, Highest) AND statusCategory != Done` | 1 | `Total` |
| Blocked | `{sprintScope} AND (status = Blocked OR labels = blocked)` | 1 | `Total` |
| UpdatedToday | `{sprintScope} AND updated >= startOfDay()` | 1 | `Total` |
| RecentlyUpdated | `{sprintScope} ORDER BY priority DESC, updated DESC` | 50 | `Items` |

Plus two `TimeLoggedService.BuildReportAsync` calls (`Today`, `ThisWeek`) → `TimeLoggedToday`/`TimeLoggedThisWeek`; try/caught, default `Zero`. Empty snapshot when disconnected.

### TimeLoggedService
Three entry points, worklog GETs at concurrency **8**, hard cap **500** issues via `SearchAllAsync`.

**`BuildReportAsync(period, customFrom, customTo, extraJql)`**
- JQL (when `extraJql` blank): `project = {project} AND sprint in openSprints() AND assignee = currentUser() AND issuetype != Incident ORDER BY updated DESC`; otherwise `extraJql` verbatim.
- Range resolution (local `Today`-based, `to` exclusive): Today → `[today, today+1d)`; Yesterday → `[today-1d, today)`; ThisWeek → `[startOfWeek, +7d)`; PreviousWeek → `[startOfWeek-7d, startOfWeek)`; ThisMonth → `[firstOfMonth, +1M)`; CustomRange → `[customFrom ?? today, customTo ?? today+1d)`. `StartOfWeek(d)`: `d - ((7 + dayOfWeek - culture.FirstDayOfWeek) % 7)`.
- Per issue: sum worklogs where `IsCurrentUser(w)` and `from <= w.Started < to` → `WorkLoggedForPeriod`. **All issues kept, including zero-logged.**
- `Total` = sum.

**`IsCurrentUser(worklog)`** — `AuthorAccountId` equals session accountId (ci) **or** `Author` equals session displayName (ci).

**`BuildReportForSprintAsync(sprintName)`**
- `sprintClause` = `sprint in openSprints()` if blank, else `sprint = ${JqlEscape.Quote(name)}`.
- JQL: `project = {project} AND {sprintClause} AND assignee = currentUser() AND issuetype != Incident ORDER BY updated DESC`.
- Sprint window from issues' `AllSprints`: first `state === "active"` (blank name) or first matching name; `sprintFrom = StartDate.local().date`, `sprintTo = EndDate.local().date + 1d`. Worklogs outside excluded.
- `DailyByIssue`: group by `(Day, IssueKey)`, sum, ordered by Day then IssueKey.
- `FromUtc`/`ToUtc` fall back to min/max daily day when sprint has no dates.
- `AvailableSprints`: JQL `project = {project} AND assignee = currentUser() AND sprint is not EMPTY ORDER BY updated DESC`, cap 200; dedupe by name (ci), **drop `state === "future"`**, sort: active first, then StartDate desc.

**`BuildReportForRangeAsync(fromLocal, toLocalExclusive)`**
- JQL: `worklogAuthor = currentUser() AND worklogDate >= "{yyyy-MM-dd}" AND worklogDate <= "{lastInclusive}" ORDER BY updated DESC` (`lastInclusive = toExcl - 1d`).
- On exception, fallback `project = {project} AND assignee = currentUser() AND sprint in openSprints()`.
- Worklogs filtered by local `Started` within `[fromDate, toExcl)`; **zero-logged issues dropped**.

### RefreshScheduler
Interval timer. `Start(intervalSeconds)` → `max(5, s)*1000` ms, first fire after one full interval; `Pause()`, `Resume()`, `TriggerNow()` (suppressed while paused). Each tick sets `LastRefreshUtc` and raises `Tick`. Default interval `AppSettings.RefreshIntervalSeconds` (120).

### MetadataWarmup
Fire-and-forget after sign-in. No-op when disconnected. `project = DefaultProjectKey ?? "ISW"`. Concurrency gate **2**; failures swallowed. Warms via cached services: priorities/statuses/issuetypes/projects; versions+components(project); boards; and for every catalog def where `!IsQuickFilter && ControlType !== TextSearch`: `GetDistinctIssueFieldAsync(project, field, 5000)` with `field = (JiraFieldName ?? DisplayName).trim('"')`.

---

## 9. DI wiring / decorator order

All singletons. `IJiraBoardService` → `CachedJiraBoardService(JiraBoardService)`; `IJiraMetadataService` → `CachedJiraMetadataService(JiraMetadataService)`. Auth/Issue/Dashboard/Worklog/CreateIssue services bind directly, no cache layer.

---

## 10. Gotchas worth carrying over

1. **`ApiPrefix` derived from `InstanceType` on every call** — Cloud switches every path to `rest/api/3`, including `POST /search` (deprecated on modern Cloud in favor of `/search/jql`). Verify if targeting Cloud.
2. `SearchIssuesAsync` sends `"Reject Reasons"` and `"Severity"` (display names with space) inside `fields` array alongside customfield ids — DC tolerates; Cloud may 400.
3. `GetBoardIssuesAsync` swallows non-2xx → `[]`; `SearchIssuesAsync` throws. Different error contracts.
4. `JqlBuilder` interpolates `defaultProjectKey` **unescaped** into `project = {key}`.
5. Three different quote helpers exist (JqlEscape.Quote, JqlBuilder.QuoteValue, IncidentVM QuoteList) with subtle differences.
6. `AppendBoardScope` is dead code.
7. `JiraDashboardGadget.Id` is raw JSON text (numeric ids unquoted, string ids with quotes).
8. Custom fields in JQL: `cf[NNNN]`, never `customfield_NNNN` (400s on DC) — but `fields` request array uses `customfield_NNNN`.
9. `worklog` must never appear under `fields` in a transition payload; goes under `update.worklog[].add`.
10. `CachedJiraBoardService` reports cache hits via human-readable string in `GreenhopperError` — not a real error.
