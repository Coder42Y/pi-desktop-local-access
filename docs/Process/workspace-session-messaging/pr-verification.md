# Personal repository PR candidate

## Target and integration
- Repository: Coder42Y/pi-desktop-local-access; base main 51025d48041c8e2e6d90006531f7f55a5297fc75.
- Branch: feat/workspace-session-messaging.
- Worktree: /home/why/Pi-Desktop-worktrees/personal-session-collaboration.
- Only the approved workspace messaging, conversation/Host filesystem consent and
  current-name lookup delta was ported. The personal repository has independent
  Git history, so no upstream history or bulk upstream update is merged.
- Existing local-file/Finder hooks, custom update provider and NEXT-ITERATION.md
  are unchanged. LGPL/license and release configuration remain intact.
- Task code digest: f973f49cf44772a29c851e89540ec13fa3f5dba8c1f6368ba9292d12ff47fd8e.

## Target-tree validation (not upstream-only evidence)
| Check | Result |
|---|---|
| Serialized full JS build: pnpm -r --workspace-concurrency=1 --if-present build | Pass |
| pnpm lint / Desktop typecheck | Pass |
| pnpm docs:check / git diff --check / pnpm check:pr-base | Pass |
| cargo test -p host-core --locked | 1134 pass, 1 existing ignored |
| cargo fmt --check / Clippy all targets | Pass; 3 existing unrelated warnings |
| Relevant JS package suites | All pass: i18n 31, shared 1374, AgentHost 67, RACP 29, AgentRuntime 1675, HostRuntime 174, pi-host 66 |
| pi-host packaging/platform cases | 4 existing skips, not counted as pass |
| Personal file/Finder/updater + new permission/remote/collaboration tests | 85 pass, no skip |
| Actual PermissionCard Chromium render/click | Included and passed; isolated profile, no user Desktop |
| External filesystem Host process E2E | Pass |
| Real two-Host RACP external reads + one write grant + subsequent Write/Bash E2E | Pass |
| Workspace messaging/name-resolution Host E2E | Pass |
| Legacy collaboration + completion-notice E2E | Pass |

Post-commit candidate E2E is rerun before branch publication; the PR body records
the exact tested task commit and base. This pre-commit record does not invent a
future tested SHA. Fresh independent review passed; see review-pre-pr.md/json.

## Dependency environment
Third-party/cache references were attempted first. pnpm rejected shared mutable
state/virtual-store symlinks and some package-manager-created relative references
were invalid in the personal tree. After confirming this environment incompatibility,
links were rebuilt offline from this repository's frozen lockfile with installation
scripts disabled: 820 cached packages reused, zero downloaded. No lockfile change.
Node/pnpm and Cargo caches/targets remain reused; temporary profiles/data stay
isolated. Parallel pnpm aggregation returned nonzero despite successful package
logs, so the complete serialized equivalent was run and explicitly returned zero.
No parallel-build success is claimed from those earlier attempts.

## Deliberate limits
No paid provider, real SSH machine, native Mac/TCC, packaged application/release,
user Desktop, or merge validation. Native session messages remain queued while
busy; this does not inject agent text as human steering. External write consent
is session/Host scoped, clears on revoke/Host restart, and does not widen plugins.
Old-name aliases/fuzzy matching/implicit replacement sessions are not added.
Historical source-checkpoint records remain clearly marked, not target evidence.
