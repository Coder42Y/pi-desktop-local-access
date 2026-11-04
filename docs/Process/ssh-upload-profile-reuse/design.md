# SSH Upload profile reuse

## Metadata
Starting plugin commit: 7c5c9f1; main ancestor: 51025d4. Dedicated worktree.
Scope approved: plugin-only new SSH workspace support; legacy rules unchanged.

## Architecture and flows
Use existing public session.getActive and read-only desktop project/get to bind
an active SSH project to its actual hostKey and remote root. Use existing plugin
getSettings/setSettings; no private host registry, DB, SSH password or key bytes.
Keep old profiles JSON. Add versioned connections and projectDirectories JSON
settings: connection records keyed by a hash of stable Host identity; project
records keyed by stable remote-project identity, storing Host association and a
relative upload directory. Unset project directory defaults below its current root.

Context -> stable binding -> validated settings -> resolved config. Save ->
serialized read/merge/validate/current-context check -> one SDK settings write ->
acknowledge only after success. Each upload snapshot is bound to configuration
identity; no stale configuration result enters another host/project/draft.

## Todo list
- [x] baseline-tests: file-backed public API repro for cross-project reuse, restart and failure safety.
- [x] profile-store: bounded versioned data, strict read validation, serialized writes and legacy preservation.
### Checkpoint
Old code fails requested reuse; new resolver preserves project/host isolation.
- [x] runtime-binding: stable current-context validation, admission/cache and result insertion guards.
- [x] renderer-reuse: bindings reset stale forms; locale guidance and recovery remain available.
### Checkpoint
Configuration changes cannot silently retarget an in-flight or completed upload.
- [x] compatibility-docs: scope/one-time confirmation/downgrade/SDK durability boundaries.
- [x] verify: process restart, pure/browser regression, DevKit, lint/syntax/docs and one review.

## Contracts
Existing profiles remains readable; new envelopes have explicit format version.
Unknown versions or malformed inner JSON fail without overwriting the record.
Host settings include SSH alias, optional port and identity path only. No password
or private-key content. Project directories are relative and validated against
current root. Legacy ambiguous targets are suggestions requiring one explicit
save before server-wide reuse. No default JSON file beside SDK settings.

## Code touch list
New profiles.cjs; main.js orchestration; paste-store and renderer paste/workflow
binding guards if required; renderer dialog/locale metadata; manifest version and
settings; configuration and cold-process tests; relevant docs.

## Testing strategy
Exercise actual main.onRendererCall against an SDK fixture writing only temporary
settings. Restart an independent Node process to prove data survives beyond
module memory. No actual user settings, network SSH or app profiles. Add strict
schema/write-failure/concurrency/stale-context cases and run existing transfer,
paste/drop/dialog/compact-status browser suites. Reuse identical host toolchain,
node_modules and unchanged built SDK packages by link; no install is necessary.

### E2E scenarios
| ID | Path | Expected |
|---|---|---|
| PROFILE-01 | save server A/project A -> cold process -> same/new chat | reused target and project directory |
| PROFILE-02 | new project B on server A | shared connection, B default/custom directory independent |
| PROFILE-03 | different server or changed binding | no borrowed directory/target; stale save rejected |
| PROFILE-04 | malformed settings/write failure | explicit error, raw old records retained |
| PROFILE-05 | concurrent saves/unload/delayed response | no lost update or stale activation |
| PROFILE-06 | legacy context | original per-context matching remains; no new metadata calls |

## Rationale and alternatives
No application/remote-Host metadata interface added for legacy histories. Do not
infer directories from conversation names or use conversation IDs for new SSH
projects. Do not silently promote an ambiguous old target to every server.

## Edge cases & lifecycle
Validate state after awaited context/settings calls. Serialize updates and retain
unrelated settings/legacy entries. No silent profile eviction. Bad inner JSON is
not an empty store. The SDK currently hides corruption of its outer settings.json
by returning defaults, and writes that outer file without an atomic guarantee;
plugin-only work cannot detect/repair this host-level behavior. Do not claim power
loss durability or full host-file corruption recovery. Native app restart and
real SSH acceptance remain separate from temporary SDK-fixture verification.

## UI / mockups
Existing A layout and settings dialog reused; no new visual design. Guidance
explains server-wide connections versus project-only directories. No verify:ui:*
or running user application tests. Acceptance uses isolated browser fixtures.

## Verified candidate outcome
45 plugin cases passed, including four isolated React/Chromium workflows and
independent file-backed cold processes. One review found a Save/admission race;
mutual exclusion and write-time activity checks fix it. The exact new regression
failed against an isolated pre-gate main snapshot and passed on current source.
No second review, application/Host changes, live settings reads, installation,
commit, push or release. SDK outer-file limits remain explicit above.
