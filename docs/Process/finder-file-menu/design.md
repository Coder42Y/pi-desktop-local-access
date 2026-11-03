# Reveal conversation file references in Finder

## Scope

Add a native folder-reveal action to the existing transcript file context menu.
On macOS the existing localized `panel.files.reveal` label is “Reveal in Finder”.
The action opens the containing folder and selects the resolved file using the
existing Electron `fsReveal` endpoint. It does not open the file in its default
application. No IPC, storage, plugin, or security-boundary change is needed.
Remote references retain only their existing permitted actions.

## Touch list and approach

- `apps/desktop/src/hooks/use-chat-file-menu.tsx`: add `reveal-in-folder` for
  native-eligible files, reuse shared folder icon and existing localization.
- `apps/desktop/src/hooks/use-preview-target.ts`: add a reveal destination that
  shares reference resolution, owner-session/stale-view guards and error toasts;
  call `api.fsReveal(resolved.absolutePath, sessionId)` and reject remote views.
- `apps/desktop/test/chat-file-open-with-menu.test.mjs`: real hook/menu behavior
  with recorded native calls; shorthand, external paths/spaces, markdown base,
  missing references, OS errors, session switches, remote sessions.
- Append behavior and acceptance scenarios to existing UX and E2E specs.

## Plan and verification

- [x] Baseline: 13 existing menu tests pass.
- [x] Red: 9 expected assertions fail because the menu/destination is absent.
- [x] Green: menu/destination implemented; all 20 menu tests pass.
- [x] Verify: 78 targeted tests, lint, typecheck and desktop build pass. Full
  suite and isolated retry evidence are recorded below.
- [x] Save: source and verification record saved as a local feature-branch
  checkpoint. No remote push, installer rebuild or installation is inferred.

The task uses a dedicated worktree and branch `feat/reveal-file-in-finder` from
`origin/main` (`cb5be62`) of Coder42Y/pi-desktop-local-access. Existing dependency
and package build outputs are reused through locally ignored links.

## Results

- 78 related menu/file/remote tests passed, including all 7 new Finder cases.
- Biome lint, style tokens, desktop TypeScript checking, electron-vite desktop
  build and `git diff --check` passed. Existing bundle-size warnings remain.
- Full desktop suite: 4660 tests, 4654 passed, 2 failed, 1 cancelled, 3 skipped.
  Failures are the same upstream `scheduled-workspace.test.mjs` outcome-label
  assertions already reproduced on the unchanged base in the previous task.
  The npm executable validation test cancelled at its 15s per-test deadline
  under concurrent suite load; all 13 tests in `npm-executable.test.mjs` passed
  when rerun alone (34s total). No claim of a globally green suite is made.
- pnpm 12 task execution refused the reused `node_modules` symlink. The exact
  installed underlying lint, TypeScript and electron-vite executables were run
  directly instead, preserving the lockfile and dependency environment.
- The final production diff was inspected for resolution-before-reveal,
  absolute paths, owner-session forwarding, stale-view guards, remote denial
  and caught native errors. Existing permissions and IPC contracts are unchanged.
- Native Finder window interaction, new DMG/ZIP packaging, replacement of the
  installed application, and remote publishing were not performed. The prior
  installer does not contain this new menu action.
