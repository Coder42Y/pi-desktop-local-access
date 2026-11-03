# PI-Desktop: local all-directory file access

This independent repository belongs to Coder42Y. It contains a complete source
snapshot of the user-requested customization, not an official upstream release
or an upstream-maintained fork. Original notices and the LGPL-3.0 license are
preserved; see [LICENSE](LICENSE).

## Provenance and modified files

- Upstream: https://github.com/vastsa/pi-desktop
- Upstream base: `b694c211f448bdb01b482c7003f5e55c612359a0` (version 0.21.0).
- Tested customization commit in the original worktree:
  `b47bbd8f6a457e7f9cdc611fc412d14d0bfbcfe1`.
- Production changes: `apps/desktop/electron/main/ipc/workspace-ipc.ts` and
  `apps/desktop/src/hooks/use-preview-target.ts`.
- New regression tests: `apps/desktop/test/local-file-access.test.mjs`.
- Design and verification: `docs/Process/local-file-access/design.md`.
- Security decision: `docs/adr/local-file-viewing-all-directories.md`.

This repository starts with a new snapshot commit. The original commit hashes
above identify provenance; upstream Git history is not imported.

## Behavior and security implications

Local absolute file links may resolve, preview, open with the OS, and reveal in
Finder outside registered project directories. External files retain their
absolute path and use the host previewer, not a project-scoped plugin.

**The trusted desktop renderer can therefore address local files anywhere the
OS allows.** This deliberately widens local file-viewing containment. It does
not grant macOS privacy permissions or bypass regular-file/type/size checks.
Plugin permissions, remote workspace dispatch and AI tool permissions remain
unchanged. Disk roots never participate in shorthand search or project indexing.
Official updates may overwrite this customization.

## Verification completed before upload

- JavaScript workspace build and Rust release build passed.
- Repository lint and desktop TypeScript checks passed.
- 75 related desktop tests and 174 shared host-runtime tests passed.
- Full desktop suite: 4648 passed, 2 failed, 3 skipped. Both failures are existing
  `scheduled-workspace.test.mjs` UI text assertions and reproduce on unchanged
  upstream source. No claim of a fully green upstream suite is made.
- One independent read-only review found no blocking defects.
- Local macOS arm64 DMG/ZIP built and passed archive integrity, ad-hoc signature,
  packaged executable Node-mode launch and embedded-policy checks.
- Installing/replacing the user's application and native packaged click
  acceptance were not performed.

Only source and project assets are uploaded. Local credentials, chat history,
user databases, node_modules and built installers are not included. The upstream
localhost TLS test certificate/key fixtures remain unchanged and are test-only.

## Development

Use Node >=22.19, the pinned pnpm 12.8.1 and Rust. Follow the original README and
AGENTS.md for build/development commands. The local build uses ad-hoc signing;
it has neither the upstream publisher's Developer ID signature nor Apple
notarization. Installer artifacts are not published by this initial upload.
