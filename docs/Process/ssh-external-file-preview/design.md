# SSH external file preview design

## Metadata
Base: origin/main 51025d4. User approved the previously explained preview-only
approach. Use existing TypeScript/Electron/Node architecture and pnpm lockfile.

## Architecture
Remote-workspace clicks: renderer -> existing file IPC -> owner workspace/files
-> pi-host preview helpers -> bounded text/image result.
Legacy clicks: renderer read capability -> remote backend -> new owner-only
workspace/preview -> session-owned root -> same workspace-files preview service.
No remote path may fall back to Desktop OS/file/plugin services.

## Contracts
Additive workspace/preview request: sessionId, operation(resolve/read/image),
ref, optional mimeType. Owner role only; unsupported Hosts fail explicitly.
Existing viewer workspace/read/list contracts remain project-contained.
No storage schema change, no local-tool capability grant. Shared preview helpers
and plugin/model runner containment remain unchanged.

## Todo list
- [x] remote-preview: external absolute resolve/read/image, missing and permission tests (pi-host source/helper/tests, <=5 files).
- [x] legacy-contract: owner-only session preview schema/route/interface/tests (shared schema/tests, RACP operations/interface/tests, <=5 files).
### Checkpoint
Current restrictions fail new regressions; project list/index/instructions remain contained.
- [x] legacy-host: derive session root server-side and reuse preview service (host-operations/tests, <=5 files).
- [x] desktop-routing: translate legacy preview IPC without local fallback (remote-backend/tests, <=5 files).
### Checkpoint
Owner/viewer authorization and disconnected-host tests pass before renderer changes.
- [x] renderer-preview: read-only guards and native-action separation (preview hook, image loader, capability helper and tests, <=5 files).
- [x] remote-panel: legacy file request reaches its own remote panel (RemoteWorkspace, work-panel file-only admission and user-path tests, <=5 files).
- [x] verify-and-docs: targeted integration/user-path tests, static/build checks and security/spec/ADR evidence.

## Code touch list
apps/pi-host/src/workspace-files.ts; host-operations.ts; packages/shared/src/racp.ts;
packages/racp/src/{operations,host-operations}.ts; remote-backend.ts;
renderer preview hook/image loader/remote workspace panel and relevant tests.

## Testing strategy
Test failures on old services first. Use synthetic temporary text/images only.
Run pi-host, shared, RACP and desktop affected suites plus full desktop regression.
Build changed packages with worktree-local links/output, reusing offline package
store because shared contract changes make cross-worktree workspace links unsafe.
Repo lint -> configured formatting policy (Biome formatter disabled) -> typecheck.

### E2E scenarios
| ID | User path | Expected |
|---|---|---|
| SSH-PREVIEW-01 | remote workspace link -> resolve -> read/image | external absolute file displayed, missing path missing |
| SSH-PREVIEW-02 | legacy session link -> owner preview -> panel | right session/host, no local OS/plugin execution |
| SSH-PREVIEW-03 | viewer/unsupported/disconnected access | rejected; no local fallback |
| SSH-PREVIEW-04 | project shorthand/index/instructions | no external search, relative/symlink escapes stay blocked |
| SSH-PREVIEW-05 | actual RACP transport -> real file service | authorization and real filesystem bytes verified |

## Edge cases & errors
Absolute symlink targets may be previewed within OS permissions; relative traversal
or relative links cannot grant external preview. Missing absolute refs resolve to
no match. Nonregular files, text/image caps and MIME rules remain in shared
helpers. Old deleted worktree paths do not become valid. No new SSH credentials.

## Rationale
Do not set the remote project root to /. Do not change readWorkspaceFile globally.
Do not grant canUseLocalTools to remote sessions. A session-bound owner endpoint
avoids exposing remote project paths or widening the old viewer endpoint.

## Implementation order
Tests -> owner file service -> additive legacy route -> desktop and renderer
wiring -> real service/transport user paths -> specs and verification.

## UI / mockups
Reuse existing file preview/panel. No visual redesign; mockups and design-review
are N/A. Do not run verify:ui:* or attach the running user app. Use isolated
component harnesses where needed. Real SSH/native installed-app acceptance remains
separate from local candidate validation.

## Verified outcome
Implementation and isolated candidate acceptance passed. No commit, push, merge,
release, live SSH install or user-profile mutation. An initial old-test capability
mock was replaced with the actual capability hook; its 17 original assertions
remain unchanged and pass. One review found the root-preview return-navigation
trap; a failing browser regression was added, the return action fixed and the
expanded browser journey passed. No second broad review was performed.
