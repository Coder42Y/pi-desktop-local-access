# Acceptance

- A1: stable server connection reused across new SSH projects/conversations and cold process restart.
- A2: directories remain project-specific and within the current remote root.
- A3: no automatic cross-host adoption, stale context write or result insertion.
- A4: old data preserved; malformed inner JSON/version/write failure cannot silently reset it.
- A5: legacy behavior, permissions, key/agent authentication and UI A remain compatible.

## Sign-off

Subsequent user authorization: commit and push this branch, then open a PR into
main. Earlier no-commit/no-push statements describe the verification snapshot.
No merge, package, installation or release is requested.

| Criterion | Evidence | Result |
|---|---|---|
| A1 | Public plugin Save/Context through a temporary SDK file; independent fresh Node processes restore same/new conversation and same-Host new project | Pass |
| A2 | Independent defaults/custom relative folders, moved root, changed Host and same project ID isolation | Pass |
| A3 | Stale form/read/Host binding guards, admission/finalization checks, held settings/metadata operations and browser changed-config result insertion rejection | Pass |
| A4 | Inner JSON/unknown version/record validation, preserved unrelated/legacy data, rejected password input, failed-write retry and serialized store saves | Pass within SDK boundary |
| A5 | Original legacy context tests and paste/drop/manual/status workflows; permission/renderer action lists unchanged | Pass |

## Executed verification

- `SSH_UPLOAD_REAL_TEST=0 SSH_UPLOAD_TEST_BROWSER_EXECUTABLE=<existing Chromium> node --test plugins/tests/*.test.*`: 45 passed, 0 failed, 0 skipped. This includes four isolated browser workflows, cold-process persistence, current RPC integration, schema/error/concurrency tests and original transport/session cases.
- Five initial new assertions failed on 0.2.3 before implementation; requested reuse and new migration/error expectations now pass.
- One reviewer P2 was fixed, with the exact regression failing on an isolated pre-gate source snapshot and passing on current source. Production source was not modified for that baseline probe.
- JS syntax checks across plugin backend/renderer; repository Biome lint and style-token check: passed. Root formatter is disabled by config; no separate formatter command exists.
- Plugin DevKit `check`: passes for local.ssh-upload@0.3.0 (13 files). Existing renderer.extension/desktop.control high-risk warnings remain, with no permission additions.
- Docs locale/link checks, architecture/policy/whitespace checks are repeated at final closeout.

## Candidate and environment

Plugin starting commit: `7c5c9f1d9e09729d4d1859270ec084f02f277e9d`; main ancestor
`51025d48041c8e2e6d90006531f7f55a5297fc75`, plus this uncommitted task diff.
Changed code/tooling SHA-256 (sorted path NUL bytes NUL, excluding docs):
`c919b94454772940383cad5ff9ea4fdb615c40aba3c56c635ddc29d8080ebb95`.
Node 24.22.0 / existing pnpm 12.8.1 environment and Chromium. Identical lockfile,
node_modules and unchanged compiled SDK/tooling reused by reference from the
previous UI worktree; no dependency install, browser download or lockfile change.
Temporary file-backed SDK providers are fixtures, not user application settings.

## Scope and data compatibility

Only new SSH workspace projects gain server-level reuse. Valid legacy remote:
matching remains old per-context behavior. Old profiles remain retained/mirrored;
unmapped old targets require one explicit confirmation before server-wide reuse.
No inferred Host association from a single old target. No profile eviction/reset.
Additional legacy metadata is preserved but not returned to renderer config.
Downgrade readers use older per-context mirrors, not automatic latest shared
connection state; recheck the destination on rollback. New connections contain
only SSH alias/port/identity path; no passwords/private-key bytes are collected.
No application, Host/RACP/SDK contract or plugin permission additions.

## Honest durability and acceptance limits

Inner JSON/version failures do not intentionally overwrite old data; rejected
settings changes do not activate proposed unsaved values. The underlying SDK
can return defaults when its outer settings.json is corrupt and writes that
whole file without an atomic guarantee. The plugin cannot prove preservation
under partial outer-file I/O failure/power loss. Do not describe these tests as
crash recovery or a real Desktop restart qualification.

No real user config/key reads, live SSH, user app/profile manipulation, native
Finder acceptance, plugin package/install, commit, push or release. No Rust/full
Desktop suite or app build was run for this plugin-only task; no application,
Rust or dependency files changed. Existing browser and real transfer-script
fixtures plus public-API/process persistence are the relevant acceptance seams.
