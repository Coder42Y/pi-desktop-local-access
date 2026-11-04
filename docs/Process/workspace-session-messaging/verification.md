> Historical upstream-based implementation checkpoint. The personal repository
> PR is based on Coder42Y/pi-desktop-local-access main; its current evidence is
> recorded in ../workspace-session-messaging/pr-verification.md.

> Historical checkpoint before the user-approved external filesystem expansion.
> The current combined candidate and remaining gates are recorded in
> ../external-filesystem-access/verification.md.

# Verification record

## Candidate
- Branch: feat/workspace-session-messaging
- Worktree: /home/why/Pi-Desktop-worktrees/workspace-session-messaging
- Base main: 3934be79335551bf51184360e93d2415eec0828d (latest fetched during candidate preparation)
- Task candidate: uncommitted working tree; no tested task commit is claimed.
- Executable/source/test aggregate SHA-256: 81409ad21c89240abc7c18f9c954e2590ceaec0173be525bf6664fdc4a068b2a
  (sorted changed/new code paths, each encoded as path NUL bytes NUL).
- No database schema migration; existing plugin defaults preserved.

## Checks actually run
| Check | Result |
|---|---|
| pnpm build:js | Pass; normal Vite chunk-size warnings |
| Desktop typecheck | Pass; rerun on refreshed candidate |
| pnpm lint | Pass; rerun on refreshed candidate |
| pnpm docs:check | Pass, 87 locale pairs and 608 pages |
| pnpm check:pr-base | Pass against recorded base |
| git diff --check | Pass |
| Shared full suite | 1374 pass (source and built cases) |
| Agent Runtime full suite | 1694 pass before final closed-schema adjustment; final affected runtime/schema suite rerun, 47 pass |
| Agent Host full suite | 65 pass |
| Host full suite | 1142 pass, 1 pre-existing ignored before final additive read-provenance projection fix |
| Final native Host suite | 10 pass, including read-provenance red/green regression |
| Desktop collaboration/fork/presentation/input regressions | 48 pass; service suite 16 pass; final combined service/IPC/input rerun 32 pass |
| cargo fmt --check | Pass |
| cargo clippy -p host-core --all-targets | Pass; 3 warnings in unchanged hashline/transcripts code |
| pnpm test:e2e:workspace-messaging | Pass after final provenance fix |
| pnpm test:e2e:collaboration | Pass on final executable tree |
| pnpm test:e2e:session-completion | Pass on final executable tree |

## User-path mapping
The native E2E enters public tools.execute on a real isolated Rust Host process:
A discovers B, reads recent/older context, attempts foreign access, sends twice
with one idempotency key, and creates a subscribed worker. The worker reports a
question to still-running A and produces one durable completion. A consumes both
without recursive callbacks. Per-message agent provenance survives context reads.
Runtime HTTP/SSE fixtures separately prove ToolSearch -> native tool -> ordinary
Host gate. Main service fixtures prove native owner dispatch, existing queue
admission, duplicate avoidance, moved-workspace rejection and disabled-plugin
compatibility. Agent Host tests prove the reused admission/queue lifecycle.
These are not a full Electron UI acceptance run and do not claim one.

## Review
The optional read-only review was not executed: its Read tool rejected the
worktree with PATH_OUTSIDE_WORKSPACE. No independent approval is claimed.
The implementer inspected the task diff and integration seams, added missing
native pending/validation wiring, filtered Plan sessions from discovery, excluded
native tools from inherited subagent tools, and preserved historical message
provenance with failing-then-passing tests. No second broad review was started.

## Environment and limitations
The primary checkout had no node_modules or Cargo target. Dependencies were
prepared once from the existing pnpm content-addressable cache with the frozen
lockfile and lifecycle scripts disabled; no packages were downloaded. Missing
Rust fmt/clippy components were installed. Host and test state are isolated from
user data. The primary checkout's original untracked files remain unchanged.

No verify:ui commands, user Desktop instance, real credentials, paid providers,
macOS/Windows installers, remote messaging transport, or between-tool steering
were used or claimed. Busy receipt intentionally remains queued. Explicit report
subscriptions are an operation contract plus model instruction, not natural-
language consent parsing. The session checklist tool returned TOOL_TURN_CANCELLED
and could not update the UI; completed status is recorded in design.md instead.

## Outcome
Implementation and relevant automated verification complete; no known in-scope
functional blocker. Independent review remains unavailable, and full Desktop UI
acceptance was not run. Changes are not committed, pushed, merged or released.
