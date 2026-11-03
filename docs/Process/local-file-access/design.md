# Unrestricted local file viewing

## Scope and approved behavior

The user explicitly requested access to all local directories and approved changing, testing and packaging a local macOS build. Local transcript reference resolution, host preview/image reads, OS opening and Finder reveal may address any existing local file. OS permissions, file checks, size limits, remote workspace routing, plugin permissions and agent tool permissions remain unchanged. No database migration or IPC schema change is needed. This is a private customized build, not an upstream security-default proposal.

## Implementation plan

Implement in the existing TypeScript/Electron architecture on `fix/local-file-access`, based on `b694c211f448bdb01b482c7003f5e55c612359a0`. Keep shared host-runtime guards unchanged. Add desktop-only filesystem roots to `fsExtraRoots` and containment-only chat roots; never add disk roots to shorthand search or local attachment-store detection. On POSIX use `/`; on Windows use local drive roots. A filesystem root is containment only, not a project.

## Code touch list

- `apps/desktop/electron/main/ipc/workspace-ipc.ts`: local disk containment for local viewing endpoints only.
- `apps/desktop/src/hooks/use-preview-target.ts`: keep exact external matches absolute in the host viewer instead of a project-scoped plugin.
- `apps/desktop/test/local-file-access.test.mjs`: real temporary files, host IPC behavior, shared guard regression.
- `docs/adr/local-file-viewing-all-directories.md`: approved security boundary change.
- Relevant UX spec and E2E scenario documentation.

## Todo list

- [x] **test-and-implement**: reproduced the external-file rejection and wrong renderer plugin routing in automated tests, then enabled local disk containment in local IPC only and corrected external-file destinations.
- [x] **verify**: 75 related desktop tests and 174 host-runtime tests passed; repository lint, desktop typecheck, policy sync and diff checks passed; one independent read-only review found no blocking defects. The full desktop suite ran with 4648 passing, 2 failing and 3 skipped; both failures were reproduced on the unchanged upstream checkout.
- [x] **package**: macOS arm64 DMG/ZIP built with explicit ad-hoc signing into a separate output directory; archive, signature, embedded code and checksums verified. No installation performed.

## Verification

Use real scratch fixtures including `Desktop/secmanus-smoke/paypal-lookalike.eml`, a PNG, a missing file, a directory, spaces and a symlink. Absolute external files must resolve/read; shorthand lookup must not search external directories. The generic host-runtime guards still reject external files without an explicit root. Remote operations must retain routing/denials. Native OS opening/reveal is stubbed so tests do not launch apps. Run `node --test` for affected desktop tests; run package lint/typecheck and build commands when dependencies are available. Record any unavailable dependency or signing prerequisite rather than claiming checks passed.

## Packaging and rollback

Create a separate local DMG/ZIP. No automatic installation, database edits, app.asar patching, or replacement of `/Applications/PI-Desktop.app`. A local build is not signed/notarized by the upstream publisher and cannot bypass macOS privacy controls. Reinstalling the official build restores its directory policy; upstream updates may replace the customization.

## Environment

Fresh clone had no compatible dependency environment. Host tools: Node 26.5.0, pnpm 10.33.0, Rust 1.97.1, macOS arm64. Automatic switch to repository pnpm 12.8.1 failed with ENOEXEC. Downloading the integrity-matched pnpm 12.8.1 npm package and launching `bin/pnpm.mjs` resolved installation; all 821 packages installed with `--frozen-lockfile`. A scratch-only PATH wrapper keeps subprocesses on the same pnpm version. No package manifest or lockfile changes.

## Results

- `pnpm build:js` and `cargo build --release -p host-core`: passed.
- `pnpm lint`, desktop `tsc --noEmit`, agent policy sync and `git diff --check`: passed. Formatter check is not applicable because repository Biome formatting is explicitly disabled.
- Related desktop tests: 75 passed. Shared host-runtime: 174 passed.
- Full desktop suite from `apps/desktop`: 4653 tests; 4648 passed, 2 failed, 3 skipped, 0 cancelled. The two failures are `scheduled-workspace.test.mjs` tests “the task column reports each task's own last outcome” and “the task page reads facts, history, and the selected run in place”. Both reproduce on unchanged upstream `b694c21` (12 passed, 2 failed in that file); they expect `Failed` where current UI says `Session error`. No unrelated changes were made.
- One independent read-only review found no blocking defects.
- Initial root-directory desktop test runs were not authoritative: incorrect cwd and missing Electron runtime caused unrelated environment failures; the final package-cwd run above supersedes them. Electron's official install script restored its runtime.
- Initial unsigned package failed signature validation and was not delivered. Rebuilt with explicit ad-hoc identity `-`; `codesign --verify --deep --strict` and packaged executable Node-mode `--version` passed. No upstream Developer ID signing or notarization is claimed.
- Final DMG `hdiutil verify` and ZIP `unzip -tq`: passed. `app.asar` contains both the disk-root policy and external-match renderer routing.
- Artifacts: session workspace `PI-Desktop-local-all-directories/PI-Desktop-local-all-directories-0.21.0-arm64.dmg`, corresponding `.zip`, and `SHA256SUMS.txt`.
- Native packaged-application click acceptance and installation are not performed. The running `/Applications/PI-Desktop.app` and user database are unchanged. Official updates may replace the customization.
- Full pipeline is not globally green because of the two verified upstream failures. No automatic passed tag or upstream push/PR is authorized.
