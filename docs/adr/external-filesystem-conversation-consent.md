# ADR: Conversation-wide external filesystem consent

- Status: Reapplied on `integrate/upstream-main`
- Amends: explicit outside-path policy, automatic permission decisions and the
  owner-only remote workspace runner

## Context

Read-only review of an authorized sibling path was blocked by project
containment. Explicit filesystem reads should work on the local machine and
personal SSH Hosts. External mutation should ask once, with a clear scope, then
stop interrupting that conversation.

## Decision

Read/Glob/Grep of an explicit external path need no app-level path consent. OS
permissions, ignore policy and separate plugin or capability boundaries remain.
The Host distinguishes this from write authority. External Write/Edit, a
structural Edit move destination, and every arbitrary Bash execution require the
Host-issued filesystem-write scope even under Auto or a legacy tool-name grant.

One allow-session decision grants that conversation and its subagents broad
access to modify, write or delete accessible external files on that machine.
The card says so, and offers that action or deny. It is not a one-file grant.

Grants are separate from tool-name grants and keyed by session plus local or
SSH Host identity. A local grant never authorizes another remote machine. They
use the existing in-memory session grant, revoke and restart lifetimes. They
are not persistent global trust. One explicit grant releases same-scope
waiters. Other sessions, Hosts, plugin permissions and contract-mode denials
are unchanged.

The owner-only SSH workspace service accepts optional `allowExternalWrites` on
its validated top-level request. Only a Host-admitted relay sets it. Model
arguments cannot grant access. Reads work without it. External mutation and
Bash fail closed without it. The local machine cannot canonicalize remote
symlinks, so the local admission gate asks for broad Host consent before remote
mutations, including relative ones. The remote runner still enforces canonical
containment.

Optional `externalAccess` travels through pending and live Host events, the
runtime, the approval broker and RACP. Desktop maps a remote scope to the
connected Host instead of trusting a remote display identity.

A running collaboration delivery stores the sender's external-write ceiling.
A receiver grant cannot widen that delivery.

## Consequences

This narrows initial Auto shell and external-mutation behavior and widens
explicit read access. After approval it is not a filesystem sandbox: the user
has authorized broad writes on that Host. No OS escalation, silent key
collection or new plugin permission is added. Old runners that cannot accept
the optional grant flag must be upgraded. There is no fallback that silently
bypasses their restrictions.
