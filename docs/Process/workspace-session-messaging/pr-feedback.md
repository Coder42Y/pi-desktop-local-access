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
- [x] Targeted and full verification completed.
- [ ] Push the verified candidate and update the existing PR without merging.

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

## Final integration verification

Candidate before the mechanical test split: `10eab3f71243b0e9a4f1b46bd09cbf6b4690a764`.
Personal main incorporated by ordinary merge:
`6f7ba2b027509224e2956e0e8809222f6da918d7`.
The owner-only SSH preview changes remain included; no published history was rewritten.

- Full workspace JavaScript tests: `(umask 022; CI=true pnpm -r --if-present test)`
  passed. Desktop: 4663 passed, 23 skipped; pi-host: 72 passed, 4 skipped.
  All other workspace suites passed. The first run inherited local umask 0077
  and failed the existing read-only storage fixture (0400 versus expected 0444).
  The command-local 022 rerun passed without changing storage production code.
- Full Rust suite: 1139 passed, 1 ignored. Formatting and Clippy passed;
  three unchanged Clippy warnings remain.
- Serialized JavaScript build, lint, Desktop typecheck and documentation checks
  passed against the integrated candidate.
- Headless collaboration, external filesystem, workspace messaging, legacy
  collaboration and session completion E2E passed with the v28 Host binary.
- Architecture validation required splitting collaboration-ceiling tests out of
  the oversized external-access test module. This is a mechanical test-only
  move with shared fixture helpers, not an architecture allowlist exemption.
- Independent bounded feedback review found no open Critical/High/Medium/Low
  defects. Native macOS, physical SSH and packaged acceptance remain unrun.

The final pushed commit and remote CI status are recorded in the PR response.
No merge is authorized or performed.


## Landing review: persistence acknowledgement and queue fairness

Independent review of 024ecf4 confirmed the original authority/consumer/queue
fixes, but identified two additional concrete blockers. New regressions failed
on that head: a discarded final append still settled worker-turn successfully,
and 64 busy deliveries hid a later ready target. The landing fix retains failed
appends in memory in session order for later flushes, and adds stable internal
pending-message pagination. Permissions, existing RPC callers, ledger schema and
plugin authorization are unchanged. No second broad review is scheduled; verify
the concrete fixes through their failing regressions and integration candidates.

New checks: Host Runtime full suite 177 passed; Rust collaboration 13 passed;
Desktop service 19 passed. Candidate hashes, final E2E and remote CI evidence are
recorded in the PR before merging. Runtime crash/power-loss recovery remains
outside the in-memory headless persistence contract.
