# ADR: Shared SSH Upload connection profiles

- Status: Accepted for the user-approved plugin-only candidate
- Scope: New SSH workspace projects; legacy remote histories retain matching rules
- Source baseline: plugin/UI commit 7c5c9f1

## Context

The plugin stored a flat profile table indexed by a legacy project/session hash.
New projects on one Host repeated connection setup, and a changed Host could
reuse the same logical project's old target. Existing save/read logic already
used SDK plugin settings, but it lacked explicit shared-connection ownership.
The user approved sharing connection metadata per server and isolating upload
folders per project. After API inspection, the user explicitly chose plugin-only
new-workspace support rather than extending app/remote Host metadata APIs.

## Decision

Keep the plugin ID, privileges and system key/agent authentication. Use only the
existing public session.getActive, read-only project/get and plugin settings API.
Resolve trusted Host identity and remote root from the active remote-project
binding. Hash Host IDs for connection keys; hash Host/project pairs for folder
keys. Relative folders follow the current root without copying another project's
custom path. No connection is matched by conversation ID in this new workflow.

Retain profiles (legacy JSON); add connections `{version:1,hosts:{...}}` and
projectDirectories `{version:1,projects:{...}}`. Host records contain target,
port and identity path only. Project records contain Host hash, relativeDirectory
and legacyKey for compatibility/migration bookkeeping. Unknown inner versions,
malformed JSON and unsupported record fields fail without intentional reset.
Explicit saves update the legacy mirror while preserving unrelated entries and
unknown legacy metadata; only approved fields enter renderer DTOs.

Old target records do not establish Host identity. They remain suggestions until
one explicit save associates them with the current Host; never promote a single
old target to every server automatically. Valid legacy remote: matching remains
per-context and receives no new app/Host calls or automatic server-wide reuse.

Serialize fresh read/merge/validate/guard/write operations. After awaited metadata
and settings calls, verify current session/binding. Refuse settings changes while
uploads are active. Bind admission, finalization, stale form use and insertion
of completed results to the original configuration identity. Read operations do
not rewrite settings; unloading invalidates queued operations. Settings changes
and select/start/paste admission are mutually exclusive across asynchronous
metadata work; overlapping requests retry rather than interleave. The persistence
helper additionally serializes writes and rechecks activity before writing.

## Alternatives

- Separate raw config file/direct DB: rejected; retain existing SDK ownership.
- Globally reuse one target/custom folder: rejected; cross-host/project risk.
- Extend app/Host metadata for legacy histories: explicitly deferred by the user.
- Silently reset bad JSON or evict old records: rejected; preserve user data.

## Consequences

Plugin metadata becomes 0.3.0, with additive settings and no app version/schema or
permission changes. Older plugin versions can still read explicit-save legacy
mirrors; they do not gain automatic reuse for projects never explicitly saved.
A downgrade uses per-context mirror snapshots, not later server-wide edits made
from another project, so verify the target again before uploading after rollback.
Future storage versions must not be overwritten by an older reader.

The current SDK catches corrupt outer settings.json and returns defaults; it
also uses a synchronous non-atomic whole-file write. The plugin cannot detect or
repair that hidden outer-file failure. Do not claim crash/power-loss durability.
Tests use private temporary file-backed SDK fixtures and independent processes;
native installed-plugin restart, real key agents and live SSH remain unverified.
No passwords or private-key bytes are collected; normal OS SSH checks persist.
