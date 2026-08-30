# Android Dashboard: My Current Sprint section

Date: 2026-08-24 · Status: approved

## Goal
The Android app's Jira Dashboard shows the user's current sprint, like the
desktop "My Current Sprint" board.

## Design
- Data: reuse the existing `dashboard:mywork` cached query (assignee =
  currentUser(), unresolved or resolved ≤14d — Done sprint items included).
  No new network call.
- Sprint resolution: existing `resolveActiveSprint(issues)`; new pure helper
  `sprintIssuesOf(issues, sprint)` in `client/src/lib/viewDashboard.ts`
  returns the issues belonging to that sprint (by `issue.sprint` name).
- UI (`MobileDashboard.tsx`): between the stat tiles and "My work by status":
  a "MY CURRENT SPRINT — <name> · <days left>" label (formatSprintHeader)
  followed by the standard StatusSection/IssueCard groups
  (`groupByStatus(sprintIssues)`, no toDoSprintOnly since already scoped).
  The old bare sprint line is replaced by this header. Hidden when no active
  sprint resolves.
- Android only: section renders when `__MC_TARGET__ === 'android'`;
  desktop/narrow-web dashboard unchanged (keeps the bare sprint line).
- Tests: vitest for `sprintIssuesOf` (matching, non-matching, null sprint).

## Out of scope
Drag between statuses, separate sprint JQL per project, board fallback.
