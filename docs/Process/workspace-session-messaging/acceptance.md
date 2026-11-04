# Workspace session messaging acceptance

- A-01: Same-workspace A can discover and read bounded B history without navigation.
- A-02: A/B exchange directed messages; source is Host-authenticated, not human input.
- A-03: Busy B queues messages; idle B starts a turn without interrupting any tool.
- A-04: A-spawned/subscribed B can report a phase or question only to its bound A.
- A-05: Ordinary messages default to no callback; completion callbacks are at most
  once and never recursively subscribe. Focused session is not the routing key.
- A-06: Foreign/null-workspace/deleted sessions, spoofed senders, stale turns,
  invalid arguments, and permission escalation fail closed.
- A-07: Existing plugin collaboration and independent fork semantics are preserved.

## Sign-off
| Criterion | Evidence | Result |
|---|---|---|
| A-01 | Native Host history/paging tests; workspace-messaging E2E | Pass |
| A-02 | Host provenance regression; Main service and input-origin tests; E2E | Pass |
| A-03 | Main service admission test; Agent Host queue/lifecycle suite (65 tests) | Pass at integration level; no UI run |
| A-04 | Native spawn/report tests; workspace-messaging E2E with A still running | Pass |
| A-05 | Native/default/idempotency tests; collaboration and session-completion E2E | Pass |
| A-06 | Native Host tests including real permission RPC; workspace isolation E2E | Pass |
| A-07 | Existing collaboration/fork/presentation regression tests and legacy E2E | Pass |
