# PR 4 feedback fixes

The owner requested fixes for the confirmed review on head 1b617c401:

- P1: delivery filesystem authority must not borrow an existing receiver grant.
- P2: native tools on pi-host need the same ledger consumer and settlement path.
- P2: accepted native messages/phase reports must stay queued when human turns fill
  the Agent Host queue, then retry once capacity changes.
- CI: isolated permission-card Chromium fails before its probe with no usable
  sandbox; production browser policy must remain unchanged and assertions must run.

## Implementation boundaries
Rust remains the ledger/authorization owner. Persist the initiating filesystem
scope and enforce it on actual delivery turns and downstream messages. Share the
Node delivery lifecycle between Desktop and headless composition, preserving
plugin entry authorization. Defer native queue capacity failures. Change only the
isolated CI browser launch, never production browser preferences.

## Checklist
- [x] Initiating ceiling regression and persistent enforcement.
- [x] Shared consumer wired to headless events, queue changes and durable end.
- [x] Full human queue regression and retry after capacity returns.
- [x] CI-only fixture launch fix with actual click assertions.
- [ ] Targeted verification and update the existing PR without merging.

## Pre-commit verification

The original bad ceiling regression created an unauthorized file before the fix;
new Rust enforcement passes the source/receiver, grant-update, forged metadata,
chain/callback, Host-bound scope and ordinary-human-turn cases. Nonempty v27 data
upgrades to v28 with a backup and restrictive NULL scope; corrupt JSON is observable.
Rust full suite: 1139 pass, 1 existing ignored (fixer execution).

Real AgentHost queues filled with eight human turns reproduced permanent failure;
ordinary native and phase-report variants now retain queued records and enqueue
once after one slot opens. Main service/IPC selection: 28 pass; actual CI-mode
permission-card render/click: 2 pass, no skip. Host Runtime: 174 pass; pi-host:
66 pass and 4 existing packaging/platform skips. Serialized full JS build, docs,
lint and Desktop typecheck pass.

Real startPiHost + Rust + sidecar + local SSE executes two workers, actual reads,
two phase reports and exactly two requested completion callbacks in persisted
coordinator history. The same fixture replayed with old head's app composition
fails workers=0, coordinatorTurns=1, receipts=0. The shared consumer's notification,
queue and settled-turn hooks, plus a transcript flush, are required for the pass.
No user Desktop/real SSH/paid provider was used. Production browser options were
not changed; the Linux CI flag applies only to the isolated controlled fixture.

Post-commit merge-candidate results and final commit/base are reported on the PR.
