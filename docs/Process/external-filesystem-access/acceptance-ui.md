# External filesystem confirmation UI acceptance

The user requested one explicit confirmation authorizing future external changes,
not per-command interruptions. Existing PermissionCard primitives/style are reused;
no new page or visual mockup is needed.

- U-01: Clearly names broad external modify/write/delete access, conversation and
  subagents, and current machine/SSH Host; no permanent/global or one-file claim.
- U-02: Explicit grant sends allow-session; deny sends deny. No allow-once action on
  the scoped card and no automatic approval.
- U-03: Absent metadata preserves ordinary permission-card actions.
- U-04: Host identity is rendered as data; English/Chinese scope copy is tested.

## Sign-off
All four criteria passed in permission-external-access.test.mjs using the actual
PermissionCard, actual React handlers, isolated Chromium profile and local fixture.
No user Desktop/Browser session, real credentials or verify:ui commands were used.
