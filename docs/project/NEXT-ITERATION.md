# Next Iteration — Customized PI-Desktop

This backlog tracks the Coder42Y customization, not the upstream project's
historical milestones. Recording an item does not authorize implementation,
repository visibility changes, remote publishing or a release.

## Queue

| ID | Item | Status | Target version |
|---|---|---|---|
| NEXT-001 | Restore reliable update discovery and delivery for customized builds | Backlog — not started | To be scheduled |
| NEXT-002 | Improve SSH remote-session usability and interaction consistency, using Claude App as the experience benchmark | Backlog — scope to be refined | To be scheduled |

## NEXT-001 — Customized-build update delivery

### Observed problem

The installed `0.21.0-local.1` build fails update discovery with HTTP 404 when
requesting `https://github.com/Coder42Y/pi-desktop-local-access/releases.atom`.
The source/release repository is private and the updater is using anonymous
GitHub release discovery. GitHub CLI authentication is not automatically shared
with the desktop application.

Current updater code explicitly sets `allowPrerelease = false`, while both
custom releases are prereleases. Published assets include installers, checksums
and build information but not the update-feed metadata required by the updater.
These are additional delivery gaps, separate from the immediate 404.

The UI displays the raw error message, including HTTP response headers and
Set-Cookie content. Future error handling must present a concise localized
message and redact sensitive transport details from UI and logs. Do not copy
actual cookie values, tokens or raw response headers into this backlog.

This issue affects update discovery/delivery; it does not by itself indicate
workspace, session or plugin corruption. The user confirmed the installed
customization's external-file preview and Finder menu work successfully.

### Scope to plan

- Decide between authenticated private distribution and a public installer-only
  update repository while keeping source private. The public distribution
  repository is a candidate, not an approved decision or permission to publish.
- Align custom version identifiers, release tags, prerelease eligibility and
  feed selection; retain a clear distinction from official upstream releases.
- Generate and publish the required update metadata alongside matching archives
  and integrity information.
- Verify macOS download and installation behavior with the actual signing policy.
  Ad-hoc signing and the absence of notarization must not be treated as proven
  automatic-install compatibility.
- Simplify update errors and sanitize secrets, Cookie/Set-Cookie values and
  verbose response headers before exposing diagnostic text.

### Proposed acceptance criteria

- Discover the next eligible custom version from the selected distribution
  source without the current anonymous-private-feed 404.
- Verify channel selection, download integrity and metadata/version consistency.
- Validate safe installation under the chosen signing policy, or explicitly
  fall back to a clear manual-download flow when automatic installation is not
  supported; do not claim automatic updates work until tested end to end.
- Never embed a personal GitHub token in an installer or silently switch to the
  upstream feed and overwrite customization features.
- Keep errors concise and localized, with no credential or cookie disclosure.
- Preserve workspace, session, configuration and plugin behavior.

### Interim workaround and boundaries

Manually download installers from the private GitHub Releases page. No updater
code, credentials, repository visibility or distribution policy changes are
included in this documentation task. Implementation and target version remain
unapproved and unscheduled.

## NEXT-002 — SSH remote-session experience

### Product objective

Improve the usability and interaction consistency of SSH remote sessions,
using Claude App as the experience benchmark.

### Planning boundary

This item records the user's product direction only. The specific Claude App
experience being referenced, current workflow pain points, comparison scenarios
and desired behavior need to be clarified before design or implementation.
It does not assert that Claude App exposes a particular SSH feature or require
an exact visual clone.

The eventual proposal should identify concrete interaction gaps and agree on
scope and acceptance criteria with the user. No specific connection, message,
file, authentication or reconnection behavior is committed by this entry. No
implementation, UI redesign or remote-access permission changes are started.

## Scheduling

Both items are queued for the next iteration discussion. Priority, owners,
implementation order, acceptance details and release version remain to be agreed.
