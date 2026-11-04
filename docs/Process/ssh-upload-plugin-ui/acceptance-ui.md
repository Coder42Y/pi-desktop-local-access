# UI acceptance

- A1: gray SSH Upload label aligned with neighboring composer controls, no leading arrow.
- A2: success/failure SVG on the immediate right, green/red, never emoji.
- A3: long settled text is visually absent but status details remain accessible.
- A4: failure cancel, in-progress controls, configure/resume and session behavior unchanged.
- A5: source-only import, no personal credentials or runtime config; no persistence edits.

## Sign-off

| Criterion | Evidence | Result |
|---|---|---|
| A1 | Actual plugin renderer browser test checks exact label, computed gray and alignment with an adjacent control | Pass |
| A2 | SVG counts, accessible status names, computed green/red channel checks; no text/emoji status glyph | Pass |
| A3 | Settled text absent from DOM text queries, accessible names and tooltips retained | Pass |
| A4 | Real paste bridge with fixture RPC: keyboard failure cancellation, progress, configure/context/local mode and Resume click; original paste/drop/dialog/session workflows | Pass |
| A5 | Five transfer/config source files byte-identical to archive; manifest permissions/IDs/settings/engines unchanged; source-only archive allowlist and credential scan | Pass |

## Executed checks

- `pnpm --filter @pi-desktop/user-plugins test`: 24 passed, no failures/skips.
- `SSH_UPLOAD_REAL_TEST=0 SSH_UPLOAD_TEST_BROWSER_EXECUTABLE=<existing Chromium> pnpm --filter @pi-desktop/user-plugins test:ui`: 4 passed, no failures/skips.
- Baseline compact status test failed on the old leading-arrow label before UI changes.
- Browser test also verifies pending status is not success, failed placeholder cancellation via Enter, detached upload Resume click and local-session inactivity.
- Plugin runtime/renderer JS syntax and `pnpm lint`: passed.
- `pnpm build:js`: passed, including all existing JS packages, Desktop and docs.
- Desktop `typecheck`: passed; plugin is JS with syntax and actual browser validation.
- DevKit `check plugins/ssh-upload`: passed at 0.2.3, 12 source files. Original
  high-risk renderer.extension/desktop.control warnings remain; no grant added.
- `pnpm docs:check`: 86 locale pairs / 615 pages before final review record;
  rerun at closeout. Architecture, agent-policy and whitespace checks passed.

## Candidate identity and environment

Base main/starting HEAD: `51025d48041c8e2e6d90006531f7f55a5297fc75` plus this
uncommitted candidate diff. Changed non-doc files use sorted path NUL bytes NUL
SHA-256 `944ef0295bae9695783e219434e93c9a50e17edd75467d047d3eb5c55b15ca0a`. A local commit follows verification.

Node 24.22.0 / pnpm 12.8.1 / existing isolated Chromium. Reused 820 packages;
only the missing test-only Playwright framework and its 2 dependencies were
added. No browser download or install scripts. Lockfile changes add the plugins
workspace and 3 exact test dependencies; no existing package was upgraded.

## Privacy, provenance and limits

The supplied source archive was path/size/entry-type checked. Imported 17 source
and test files, excluding 32 macOS metadata/build entries; packaged archives are
not committed. Test machine paths and incident IDs were anonymized, not actual
settings. Common private-key/GitHub/cloud credential-format checks found no
matches; bounded pattern scanning is not exhaustive. No live profiles or private
keys were read or uploaded. The user-provided archive remains untouched.

The 5 configuration/transfer files and declared permissions/renderer actions/
settings/engines remain unchanged. The historical source smoke-test claims are
not claimed as this checkout's validation. Real SSH opt-in was explicitly 0.

Not run: installed-user-plugin activation/update, native Finder drag in the user
app, actual host dark/narrow toolbar, screen-reader live announcements, real SSH,
restart persistence and Rust/full Desktop test suites (no application/Rust code
changed). The independent plugin browser/logic suites and full workspace build
cover this UI surface. No push, package, release or installation is requested.
