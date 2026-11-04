> Historical upstream-based implementation checkpoint. The personal repository
> PR is based on Coder42Y/pi-desktop-local-access main; its current evidence is
> recorded in ../workspace-session-messaging/pr-verification.md.

# Session-name resolution verification

## Candidate and scope
- Branch: feat/workspace-session-messaging.
- Worktree: /home/why/Pi-Desktop-worktrees/workspace-session-messaging.
- Base main: 937312e7450a8586d98faab6c1d19653c445ea42, fetched and incorporated before final validation.
- Tested candidate is uncommitted; no task commit or release is claimed.
- This is the explicitly approved supplement to the existing session messaging
  work. Earlier permission and messaging changes were preserved.

## Observable contract
SessionList accepts optional name for exact current-title lookup before its bound.
SessionRead/SendMessage accept exactly one sessionId or sessionName. Host queries
latest persisted title under its existing state lock, with no alias cache, fuzzy
matching, implicit creation or runtime restart. Unique matches resolve to stable
IDs; duplicates return CONFLICT plus bounded candidates and require user selection.
Missing/former names return NOT_FOUND. Named lookup includes current/Plan matches
to avoid hidden duplicates; actual sending retains Agent-mode enforcement.

## Main files
- crates/host-core/src/session_collaboration/workspace.rs: current-title query,
  normalized full-name resolution and structured disambiguation errors.
- crates/host-core/src/rpc/workspace_session_tools.rs: additive tool arguments and
  candidate-bearing errors; existing ID calls stay compatible.
- packages/agent-runtime/src/session-tools.ts: name arguments and fresh-lookup /
  no-implicit-spawn guidance.
- New workspace_session_names_tests.rs, runtime schema/HTTP-SSE tests, and the
  extended e2e-workspace-session-messaging.mjs.
- Existing workspace-session ADR, runtime spec, E2E plan and unreleased notes.

## Checks actually run on the final candidate
| Check | Result |
|---|---|
| Native session tools + name tests | 14 pass |
| Permission policy tests after incoming Computer registration merge | 22 pass |
| Agent Runtime full suite | 119 files, 1696 tests pass |
| Session schemas + HTTP/SSE runtime contract suite | 49 pass (included in full runtime suite) |
| pnpm build:js | Pass, usual Vite size warnings |
| pnpm lint | Pass |
| Desktop / Agent Runtime typecheck | Pass |
| cargo fmt --check / Clippy all targets | Pass; existing baseline warnings |
| test:e2e:workspace-messaging | Pass; includes public rename -> current-name read/send, ambiguity, missing names and identity after another rename |
| test:e2e:collaboration | Pass, legacy plugin/independent-session compatibility |
| test:e2e:session-completion | Pass |
| pnpm check:pr-base / git diff --check | Pass |
| pnpm docs:check | Pass after latest base incorporated the previous ADR renumbering |

## Test entry and preserved invariants
Tests enter the same session.rename Host RPC as the sidebar, with A's durable
turn still active. A can use B's new name immediately, and the queued message
still targets B after a second rename. A requested callback stays bound to the
original source/target/reply IDs. A same-named foreign session is not a match;
same-workspace duplicates cannot send or create. New lookup SQL filters current
full title before limiting, so older sessions beyond the default recent 100 remain
addressable. The model fixture proves name parameters reach the normal Host gate,
not SessionSpawn. Existing transcript/provenance and permission ownership remain.

## Deliberate validation boundaries
No real model/provider call, user Desktop interaction, actual sidebar clicks,
macOS/SSH deployment or independent review was performed for this supplement.
The rename UI itself is unchanged; Host RPC and runtime/contract tests cover the
changed behavior. Full Rust was not repeated: the relevant Rust suites were run;
prior whole-suite instability is recorded in the preceding permission checkpoint.
No new known in-scope blocker remains. Running installed software is unchanged
until these uncommitted changes are integrated and built/released.
