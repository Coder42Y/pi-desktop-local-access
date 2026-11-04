# External filesystem access acceptance

- E-01: Main and subagent explicit reads outside project succeed locally and on SSH
  without a filesystem-write authorization; OS denial remains observable.
- E-02: Initial external mutation/arbitrary shell cannot bypass UI through Auto,
  an old per-tool grant or forged model arguments.
- E-03: One explicit conversation+Host authorization covers subsequent operations
  and matching waiting requests; other sessions/Hosts remain separate.
- E-04: Deny/cancel/revoke fail closed; no unexpected file mutation occurs.
- E-05: UI explains broad external mutation scope and sends allow-session, not
  an inaccurately labeled one-file grant. Metadata survives late attach/RACP.
- E-06: SSH runner enforces the trusted owner-side write flag; paths and permission
  decisions are not reinterpreted as local filesystem operations.

## Sign-off
| Criterion | Evidence | Result |
|---|---|---|
| E-01 | Local Host external reads/searches + real remote owner runner E2E | Pass on Linux fixtures |
| E-02 | Public Host RPC tests, pre-write file-absence assertion, forged flag tests | Pass |
| E-03 | Scoped reuse/concurrent waiters/host-session isolation tests; remote three mutations after one prompt | Pass |
| E-04 | Deny/allow-once/revoke/cancellation tests; no-file-mutation E2E | Pass |
| E-05 | Actual PermissionCard Chromium click test EN/zh-CN; live/snapshot metadata tests | Pass |
| E-06 | Two real Hosts + RACP relay; owner approval regression and replay/flag checks | Pass; no real SSH target |
