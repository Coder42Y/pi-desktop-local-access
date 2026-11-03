# Temporary release asset transfer bridge

## User approval and scope

After large direct uploads failed on multiple official GitHub upload edges, the
user explicitly approved a temporary upload branch that sends 4 MiB chunks and
uses GitHub Actions to restore complete installers, then cleans transfer parts.
The user also approved prereleases from the tested candidate while PR #1 stays
open and main is not merged pending Linux Rust CI. Do not alter main.

## Implementation

This branch reuses the existing manually dispatchable workflow path
`.github/workflows/linux-package.yml` only on
`refs/heads/chore/release-asset-transfer`. Its version on main remains untouched.
The workflow is dispatched explicitly with this branch ref, has contents-write
permission only for its job token, and operates only on the two existing draft
releases. It never publishes releases or executes installer contents.

`release-asset-bridge.py` validates names, chunk order, sizes, digests and release
identity; downloads only listed chunks; assembles in a private runner temporary
directory; verifies each complete file; uploads complete installers without
clobbering nonempty assets; checks remote SHA-256 (or downloads for verification
if unavailable). Only after every complete installer is verified does it delete
listed chunks and the transfer manifest. The release remains draft for final
local verification and publishing. Missing/corrupt inputs fail closed.

## Validation

- 12 unit tests first failed because the helper was absent, then all passed.
- Tests cover reassembly, path traversal, wrong release, duplicate/invalid names,
  wrong chunk order/sizes, missing/corrupt chunks, final digest and symlinks.
- Python AST parsing, workflow YAML parsing and temporary-branch guard checks
  passed; git whitespace checks passed.
- No changes to application source, production permissions or main are made.

## Runtime evidence

GitHub workflow run URLs and helper commit will be retained in release notes
and BUILD-INFO.json. Runtime success and uploaded asset digests must be checked
before either draft release is published. Transfer failures retain chunks for
resume; do not overwrite successful assets blindly.
