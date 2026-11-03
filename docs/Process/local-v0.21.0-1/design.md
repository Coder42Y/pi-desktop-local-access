# local-v0.21.0-1 publication record

## Approved delivery

Push the Finder menu customization to Coder42Y/pi-desktop-local-access, rebuild
macOS arm64 packages, and store versioned installers in a GitHub Release. Keep
previous local artifacts and the installed application unchanged.

## Source and integration

- Feature commit: `f7488d5`, based on `cb5be62`.
- Independent pre-push review: Critical/High/Medium/Low all zero.
- Feature branch is pushed and PR #1 targets main.
- Initial import CI failed when comparing against an all-zero pre-import SHA;
  the PR's architecture check passes against its real base.
- PR docs checks exposed two omissions in the custom ADR: missing Context
  heading and missing index entry. Publication repairs those metadata omissions.
- Two scheduled-workspace tests still expected Failed although the established
  English status string is Session error. Only the two exact assertions are
  corrected; no scheduled-task production behavior changes.

## Local verification

- Fresh feature tests: 78 passed; lint, style tokens, desktop typecheck,
  electron-vite desktop build and architecture check passed.
- Publication repairs: docs locales (86 pairs) and docs validation (603 pages)
  passed; 42 targeted tests passed, including the previously failing assertions.
- Earlier full-suite findings and isolated npm timeout retry are preserved in
  `docs/Process/finder-file-menu/design.md`; a new complete suite and remote
  integration checks must be reported with their actual results.

## Versioned build policy

- Release tag: `local-v0.21.0-1`; packaged application: `0.21.0-local.1`.
- Base workspace/protocol version remains 0.21.0; extraMetadata sets the custom
  app/package version without changing native protocol versions.
- Build compiled desktop code from the release candidate; unchanged Rust host
  and agent-runtime sources reuse their matching existing release outputs.
- Explicit ad-hoc identity `-`; no Developer ID identity or notarization.
- Override the embedded GitHub update source to Coder42Y/pi-desktop-local-access.
- Build DMG/ZIP into a new version-specific directory. Verify codesign, DMG/ZIP,
  app version, embedded Finder action, disk-root policy and update repository.
- Upload DMG, ZIP, SHA256SUMS.txt and BUILD-INFO.json. Retain artifact hashes,
  source SHA and limitations in Release assets/notes. Do not silently replace
  assets of an existing release or label unpassed checks as successful.

## Publication status

Pending final remote integration and installer verification. GitHub Release
notes and BUILD-INFO.json will carry the actual source commit and gate results.
