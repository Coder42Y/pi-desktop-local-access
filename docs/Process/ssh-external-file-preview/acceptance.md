# Acceptance

- A1: owner UI previews explicit project-external text/images on the selected SSH server.
- A2: relative traversal/search/index/instructions, plugin and tool scopes stay contained.
- A3: legacy viewer read/list and local-tool denial remain unchanged; only owner preview broadens.
- A4: missing files, OS denial, size/MIME/nonregular checks and disconnect fail safely without local fallback.
- A5: both remote-workspace and legacy session paths preserve host/session ownership.

## Sign-off

Subsequent checkpoint authorization: the user requested commit, push and a PR
for this implementation, plus recording NEXT-004 only. Earlier no-commit/no-push
statements below describe the pre-checkpoint verification snapshot. No merge,
release, live deployment or SSH Upload UI implementation is requested.

| Criterion | Evidence | Result |
|---|---|---|
| A1 | 11 pi-host file tests and isolated click-to-display journeys in both SSH modes | Pass |
| A2 | Relative traversal/link tests; project index/instruction tests; pi-host tools/plugin and unchanged host-runtime suites | Pass |
| A3 | RACP owner/viewer protocol tests; real authenticated WebSocket checks; native-open and local-tool denials | Pass |
| A4 | Missing/size/MIME/OS-permission tests; actual disconnected-client rejection; no local fallback | Pass |
| A5 | Legacy backend session-ID tests and actual UI switch during held preview response | Pass |

Task candidate: base HEAD/origin-main `51025d48041c8e2e6d90006531f7f55a5297fc75`
plus this uncommitted task diff. Refreshed main remains its ancestor.
Changed-code SHA-256 (sorted path NUL bytes NUL, excluding docs):
`64d6c51b08b3ecfbd8b8ee2f055453348b93137701ec87c2baf93f5a94314cca`.

## Commands and results actually observed

- `pnpm lint`: pass (Biome and style tokens). Repository Biome formatter is
  disabled; no separate formatter command exists. Whitespace checks passed.
- Desktop, pi-host, RACP and shared `typecheck`: pass.
- `pnpm build:js`: pass, including all JS packages, Desktop and docs site.
- `(umask 022; pnpm --filter @pi-desktop/desktop test)`: 4,677 total,
  4,654 passed, 0 failed, 23 platform/display skips.
- `pnpm --filter @pi-desktop/shared test`: 1,374 executions passed (source and
  compiled tests both run under the existing configuration).
- `pnpm --filter @pi-desktop/racp test`: 30 passed.
- `pnpm --filter @pi-desktop/pi-host test`: 71 passed, 4 environment-dependent
  packaging tests skipped; no test failures.
- `pnpm --filter @pi-desktop/host-runtime test`: 174 passed.
- `PI_CHROMIUM_EXECUTABLE=<existing Chromium> pnpm test:e2e:ssh-external-preview`:
  pass with actual React, real RACP WebSocket authorization and real temporary
  files. Both modes: external text/image display, missing-file message and no
  native opening. Legacy: preview -> back -> sibling, read failure -> back ->
  sibling. Stale-session response and disconnected no-fallback passed.
- `pnpm docs:check`: 86 locale pairs / 617 pages passed before this final review
  record; final closeout reruns it.
- Architecture, agent-policy sync, current-main base and diff whitespace checks:
  passed. New modules remain below project size budgets.

## Baseline and remediation evidence

Five new server file-view regressions failed on old implementation; the legacy
backend regression and both new protocol tests also failed before implementation.
The isolated full UI test caught an API-layer guard still rejecting remote file
resolution; it was corrected without allowing native actions. Existing tool-row
fixture wiring lacked the new capability export; it now uses the actual hook,
with its 17 old behavior assertions unchanged. A single read-only review found
that root-file preview stranded the file list. That bug was reproduced in the
browser, fixed with Back to files, and the original plus expanded journey rerun.
Test-harness lifecycle cleanup was also verified after fixing a temporary-profile
removal race. These were test-only files; no running user process was touched.

## Environment and limits

Linux Node 24.22.0 / pnpm 12.8.1. Affected shared contracts require worktree-local
workspace links and build output; pnpm reused 820 packages offline from the
existing store, downloaded zero packages and did not run install scripts.
No lockfile changes. Chromium is an existing executable with a disposable
profile, loopback-only test endpoints and no user cookies or model credentials.
Its test-only no-sandbox flag does not change production browser configuration.

No Rust production code changed, so Rust build/test suites were not run. No
verify:ui:* command, real SSH installation, paid provider call, native Mac/Windows
packaging or running-user-app acceptance was performed. This does not claim the
installed app has changed; matching updated Desktop and pi-host are required.
No commit/push/release is authorized by this implementation request.
