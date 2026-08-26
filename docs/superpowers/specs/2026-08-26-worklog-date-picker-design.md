# Worklog Date Picker — Design

**Date:** 2026-08-26
**Status:** Approved

## Problem

Logging work should allow choosing any start date, like Jira.

1. **Transition dialog** (`client/src/dialogs/TransitionDialog.tsx`): when a transition screen
   includes the `worklog` field, the dialog shows only "Time Spent" + Comment. The server posts
   `update.worklog = [{ add: { timeSpent } }]` (`core/src/jira/issueService.ts`) with no
   `started`, so Jira stamps the worklog with "now". Jira's own transition screen offers a
   "Date Started" field here.
2. **Log Work dialog** (`client/src/dialogs/LogWork.tsx`): a "Date Started" `datetime-local`
   field exists and works, but the native calendar indicator is invisible/hard to discover in
   the dark theme, so users don't realize the date can be changed.

## Design

### Transition dialog — new "Date Started" field

- When the transition screen contains the `worklog` field, render a "Date Started" row directly
  under "Time Spent": a `datetime-local` input defaulting to now (same `nowLocalInput` pattern
  as LogWork) plus a calendar button that calls `input.showPicker()` (try/catch, fallback
  `focus()`).
- The value is sent only when Time Spent is non-empty. Not required; defaults to now.

### API chain — pass `started` through the transition

- `client/src/api/client.ts`: `performTransition` payload gains optional `worklogStarted`
  (ISO 8601 string, from `new Date(value).toISOString()`).
- Server route (`server/src/routes/issues.ts`): forward `worklogStarted` to the service.
- `core/src/jira/issueService.ts` `performTransitionWithData`: new optional `worklogStarted`
  param. When `timeSpent` is present and `worklogStarted` given:
  `update.worklog = [{ add: { timeSpent, started: formatWorklogStarted(new Date(worklogStarted)) } }]`
  — reuse `formatWorklogStarted` from `core/src/jira/worklogService.ts` (Jira requires
  `yyyy-MM-dd'T'HH:mm:ss.SSSZZ`). When absent, behavior unchanged (omit `started`).

### Log Work dialog — make existing date field discoverable

- Add the same calendar button (`showPicker()`) beside "Date Started".
- `client/src/theme.css`: style `input[type="datetime-local"]::-webkit-calendar-picker-indicator`
  (and `input[type="date"]`) — visible in dark theme (invert filter), `opacity: 1`,
  `cursor: pointer`.

## Out of scope

- Mobile screens (they open the same dialogs — fixes apply automatically).
- Pomodoro auto-log (uses the timer's real start time).
- Custom calendar component.

## Testing

- **core:** transition body includes `started` (formatted) when `worklogStarted` passed;
  omitted when absent; worklog `add` unchanged shape otherwise.
- **client:** TransitionDialog renders "Date Started" only when worklog field present; value
  flows into `performTransition` payload; omitted when Time Spent empty. LogWork calendar
  button calls `showPicker` (mocked). Existing submit tests stay green.
