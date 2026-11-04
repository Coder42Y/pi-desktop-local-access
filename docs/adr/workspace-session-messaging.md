# ADR: Native workspace session collaboration

- Status: Implemented candidate
- Amends: ADR 0239's plugin-only entry restriction; ADR 0165's withdrawn A2A
  surface stays withdrawn. Existing plugin behavior is unchanged.

## Context
The user approved weaker session boundaries within a workspace: independent
sessions can discover each other, read selected history, and exchange messages.
A delegated session should report phases or questions to the initiating session,
not whichever session the user currently has focused. Fork already copies a
snapshot and deliberately stores no lineage; it is not notification authorization.

## Decision
Add Agent-only native tools SessionList, SessionRead, SendMessage, SessionSpawn,
and SessionReport through ordinary Host tools.execute permissions. Rust validates
the actual durable source turn and a non-null persisted workspace identity.
Discover/read/send reject foreign workspaces; null temporary roots are not shared.
Read returns bounded data-only transcript pages with explicit source identity,
not model-system state, credentials, file grants, or user authority.

Reuse the existing durable ledger, Agent Host admission queue, turn-bound
settlement, source framing, hop/inbox bounds and restart fence. No second broker,
store, or direct renderer execution is added. Native deliveries use the reserved
owner namespace host:workspace-sessions in the historical plugin_id field; this
is neither plugin impersonation nor an exemption for disabled real plugins.
The native tools do not accept sender/owner identities from model arguments.
Queued native messages revalidate workspace membership when dispatched/claimed.

Ordinary SendMessage defaults notifyOnCompletion to false. Only explicit user
intent should set it true. SessionSpawn establishes the requested originating
relationship and defaults it true. SessionReport resolves the destination from
the current subscribed delivery and emits phase_completed or waiting_input as
data; it neither proves final success nor approves a permission. Reports and
completion callbacks never subscribe to callbacks. The user can still explicitly
request a directed SendMessage without creating an automatic report subscription.

Busy sessions receive messages in their existing turn queue. We do not inject
agent messages through the human steering path: that would conflate provenance
and conflict with the ledger's unique delivery-turn identity. Idle admission starts
a turn. Current focus never selects the destination. Native tools cannot be used
from subagent delegation scopes or contract modes. Target permissions cannot exceed
the initiating authorization ceiling.

## Consequences
The official orchestrator remains compatible and optional for native messaging.
Schema v28 additively stores the initiating filesystem scope in the existing ledger; v27 rows retain their data with an unauthorized NULL scope. Workspace
collaboration is not a shared live model context, file authority, team scheduler,
broadcast facility, cross-host transport, or an arbitrary session-control API.

## Alternatives
- A new message bus: rejected because it duplicates identity, recovery and ownership.
- Forge an official plugin context: rejected because it bypasses plugin authority.
- Attach messages as human steering: rejected because agent text is not consent.
- Enable callbacks on every ordinary message: rejected because unsolicited reports
  and acknowledgement loops violate the user's requested notification boundary.

## Verification
See docs/Process/workspace-session-messaging/acceptance.md and
E2E-SESSION-workspace-messaging in the delivery E2E plan.

## Amendment: current names resolve to stable Session IDs

The user approved name-aware collaboration after sidebar rename. SessionList gains
an optional exact current-title lookup, and SessionRead/SendMessage accept exactly
one stable ID or current name. Rust queries persisted titles during execution;
there is no alias cache, fuzzy matching or forced runtime restart. Name lookup is
scoped before bounding candidates and includes current/Plan matches so duplicate
names do not select a hidden alternative. Reading still has the same authority as
an ID-based read; sending keeps the existing Agent-mode requirement.

Unique resolution pins the existing ID. Ambiguity returns bounded candidates and
requires user selection; missing/former names do not imply creation. Existing
history, message provenance, fork snapshots and callback bindings are not rewritten
on rename. No new database schema, lineages, aliases or model-context injection is
introduced. Tests use the public rename RPC while another conversation stays active.

## PR feedback correction: initiating ceiling and headless delivery

The ledger captures the initiating external filesystem scope and destination Host
from Host-owned grants, intersecting any incoming delivery ceiling. Queuing, later
grant changes, chaining, phase reports and callbacks cannot elevate that snapshot.
Actual durable running-turn identity governs enforcement; caller turn metadata or
permissionScope cannot select a less restrictive context. A receiver's prior grant
is not authority for the sender. Reads/in-workspace permitted operations and later
human turns retain their own policies.

A shared Node consumer in host-runtime drives the existing ledger/admission/queue
for Desktop and pi-host. Headless composition subscribes to ledger notifications,
queue changes and successfully persisted terminal turns; completion settlement waits
for transcript persistence. No second broker or SQLite owner is introduced.
Accepted native deliveries and phase reports stay pending on AGENT_BUSY and retry
after queue capacity changes, without duplicate enqueueing or callback chains.
