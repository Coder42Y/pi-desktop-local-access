# Session name resolution design

## Architecture and contracts
Reuse Host-owned session.rename and persisted sessions.title/id. No new name cache,
alias table, renderer workflow, database migration or runtime prompt injection.
SessionList gains optional name for exact, current-title lookup before pagination.
SessionRead and SendMessage accept exactly one sessionId or sessionName. Existing
ID-based callers remain compatible. Name queries use normalized current full title,
not fuzzy matches or truncated list previews. Host resolves and reads/enqueues while
holding its existing state lock. Ambiguous/missing names return structured
CONFLICT/NOT_FOUND with bounded candidate IDs/titles; neither mutates nor creates.
Tool descriptions require fresh lookups for user-mentioned names and asking the
user on ambiguity. A unique name is pinned to its real ID at delivery time.

## Todo list
- [x] host-resolution: live title queries and fail-closed read/send resolution.
- [x] runtime-contract: additive arguments and model guidance, no forced restart.
- [x] verification: rename/read/send user path, ambiguity/isolation and regressions.

## Testing
Public session.rename RPC followed by native tools on the same active A turn.
Verify new title maps to original B, old name no longer matches, messages and queued
callbacks still target stable IDs after another rename, duplicate names cannot
send, misses create nothing, and foreign/deleted/temporary sessions do not match.
Verify full Unicode/long titles and lookup before the 100-row directory bound.
Runtime contract + HTTP/SSE tests prove name arguments reach the ordinary Host gate.
Real Host subprocess E2E reuses workspace-messaging journey. No real providers/UI.

## Delivery
Implemented as the user-approved supplement in the same dedicated request worktree.
The current candidate incorporates origin/main 937312e7450a8586d98faab6c1d19653c445ea42.
Task-owned merge conflicts in tool registration and documentation were resolved
without discarding incoming Computer Use policy or prior filesystem consent.
No commit, push, deployment, paid API, or user Desktop access was performed.
