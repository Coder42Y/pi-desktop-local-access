# ADR: Conversation-wide external filesystem consent

- Status: Implemented candidate; explicitly approved by the user
- Amends: explicit outside-path policy, automatic permission decisions and the
  owner-only remote workspace runner

## Context
Read-only review in an authorized sibling worktree was blocked by project
containment. The user requests unrestricted explicit filesystem reads both on the
local machine and personal SSH Hosts. External mutation should ask once with a
clear UI scope, then stop interrupting that conversation's work.

## Decision
Read/Glob/Grep explicit external paths no longer require app-level path consent;
OS permissions, ignore policy and separate plugin/capability boundaries remain.
The Host distinguishes this from write authority. External Write/Edit, structural
Edit delete/move destinations, and every arbitrary Bash execution require the
Host-issued filesystem-write scope even under Auto or legacy tool grants.
One allow-session decision grants the conversation and its subagents broad access
to modify/write/delete accessible external files on that machine. The UI says so
explicitly and offers that action or deny, not a mislabeled one-file grant.

Grants are separate from tool-name grants and keyed by session plus local/SSH Host
identity. A local grant never authorizes another remote machine. They use existing
in-memory session-grant/revoke/restart lifetimes, not persistent global trust.
Same-scope concurrent approval waiters are released by one explicit grant; other
sessions, Hosts, plugin permissions and contract-mode denials are unchanged.

The owner-only SSH workspace service adds optional allowExternalWrites to its
validated top-level request. Only Host-admitted relay requests set it; model args
cannot grant access. Reads work without it; external mutation and Bash fail closed
without it. Since the local machine cannot canonicalize remote symlinks, the local
admission gate conservatively requests broad Host consent before remote mutations,
including relative ones. The remote runner still enforces canonical containment.

Optional externalAccess metadata travels through pending/live Host events,
Runtime, the approval broker and RACP. Desktop maps remote scope to the actual
connected Host instead of trusting an arbitrary remote display identity.

## Alternatives
Static shell inspection cannot prove a command/script's actual writes. System
sandboxes across macOS and arbitrary SSH Linux machines would be a separate larger
compatibility project. Asking once before arbitrary Bash, followed by broad
conversation authorization, matches the clarified user intent without pretending
to provide per-file sandbox enforcement. Reusing generic tool AllowSession would
misrepresent consent and cross target-machine boundaries.

## Consequences
This intentionally narrows initial Auto shell/mutation behavior and widens explicit
read access. First remote mutation may prompt even when its spelling is inside the
workspace. After approval it is not a filesystem sandbox: the user has authorized
broad writes on that Host. No OS escalation, silent key collection or new plugin
permission is added. Old runners that cannot accept the optional grant flag must
be upgraded; no fallback silently bypasses their restrictions. Scope grants stay
in memory; schema v28 separately persists per-delivery initiating scope ceilings
so receiver grants cannot widen queued or running collaboration work.

The external filesystem approval retains allow-session in its offered decisions
under the default remote policy. AgentHost permits that decision only to a paired
owner (or an explicitly enabled remote session-grant policy). This does not turn
on ordinary remote tool-wide grants. Completed responses remain idempotent.
