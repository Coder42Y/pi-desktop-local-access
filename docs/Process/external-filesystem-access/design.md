# External filesystem authorization design

## Approved contract
Explicit Read/Glob/Grep may read outside workspace subject to OS permissions.
External Write/Edit and arbitrary Bash require an explicit Host-issued external
filesystem-write scope even in Auto or with older per-tool grants. Because shell
text cannot prove filesystem side effects, the first Bash is conservatively scoped.
One allow-session confirmation grants future external mutation on the same Host,
including subagents, without repeated prompts. Deny never executes. Other sessions
and SSH Hosts do not inherit this authorization. Existing revoke/restart lifecycle
applies; no persistent grant or schema migration is added.

## Architecture
Rust owns scope, target identity and grants. Shared optional externalAccess metadata
(kind filesystem-write, optional hostKey) reaches the UI through live and pending
requests and RACP. UI clearly offers conversation-wide allow-session or deny.
The SSH owner-only workspace runner accepts top-level allowExternalWrites only
from the admitted Host relay; model args cannot manufacture it. Remote reads do
not require the flag; external writes/Bash do. Old clients omit it and fail closed.

## Todo list
- [x] host-policy: free explicit reads and scoped one-time mutation authorization.
- [x] approval-ui: clear localized scope and matching allow-session action.
- [x] ssh-relay: retain authenticated scope metadata and trusted execution flag.
- [x] verification: targeted user-path checks completed; full-suite and baseline documentation limitations recorded in verification.md.

## Tests
Local real tools.execute: read outside without prompt; Auto mutation waits before
writing; deny keeps file absent; one confirmation covers later Write/Edit/Bash and
same-scope pending requests; other sessions/hosts still prompt. SSH owner runner:
read outside, external write false/true, forged args do not grant, cancellation.
UI component: scoped grant -> allow-session, deny -> deny, legacy card unchanged.
All tests use temporary roots and local fixtures. No verify:ui or real SSH target.

## Compatibility
This intentionally narrows Auto for initial arbitrary shell/outside mutation and
widens explicit read access. Preserve Plan/Goal denials, plugin isolation and OS
permissions. Update old test fixtures requiring unrelated shell execution with
explicit grants, not production test-only bypasses. Add an ADR/spec amendment.

## Outcome
Implemented candidate, targeted checks green. Independent read-only review found
one remote approval mismatch; it was reproduced, fixed narrowly for paired owner
filesystem consent, and retested through AgentHost/RACP. No second review round.
Latest base e551953357b6dc633ba64184736e297126445c5a is incorporated. Full Rust and
baseline docs gates are not entirely clean; see verification.md. No commit/push.
