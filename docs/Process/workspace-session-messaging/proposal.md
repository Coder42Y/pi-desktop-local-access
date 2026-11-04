# Workspace session messaging

## Approval and goals
The user approved workspace-scoped session discovery, on-demand context reads,
directed messages, and explicit origin-bound phase reports after reviewing Claude
Code's separation of history access, messaging, and completion subscriptions.
Reuse the Host collaboration ledger and queue; do not introduce another broker.

## Scope
Local durable Agent sessions in the same persisted workspace. Independent sessions
may communicate without parent lineage. Temporary sessions are not one shared
workspace. Existing plugin operations and fork snapshot semantics stay compatible.
Busy sessions accept messages into their existing queue, without interrupting a
running tool. Between-tool steering is not introduced by disguising agent messages
as human input. Remote transport and a new collaboration UI are out of scope.

## Success
A can discover/read B, send work, and receive a requested result. A spawned B can
report phase completion or a question to A, without tracking the focused session.
Messages do not grant permission, broadcast, or recursively request callbacks.
