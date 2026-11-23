# PI-Desktop local access fork

This repository belongs to Coder42Y. It is not an official upstream release.
Original notices and the LGPL-3.0 license are preserved; see [LICENSE](LICENSE).

## Integration

`integrate/upstream-main` starts from upstream `main` at
`7254a0452` (2026-11-23, package version `0.24.0-beta.1` plus later commits).
The previous fork history does not share commits with upstream, so this is a
new line rather than a merge of the old snapshot.

Reapplied on top of that upstream tree:
- Quote a selected model reply into the composer. The quote stays separate from
  the draft, can be removed alone, and is sent as an explicit quotation.
- SSH owner previews of an explicit absolute file outside the project. Relative
  paths, listing, search, instructions and tools stay inside the project. A
  remote preview does not open the local file manager or OS.
- Update discovery stays on `Coder42Y/pi-desktop-local-access`, channel `local`.
  It does not follow `vastsa/PI-Desktop`.
- The `plugins/ssh-upload` plugin and its tests.
- The manual fork release workflow and custom-update release check.

Not replayed yet. Upstream already replaced these, or the host code they patched
has been rewritten:
- Disk-root viewing of every directory. Upstream ADR 0339 now opens an exact
  absolute local file outside managed roots. Directories outside those roots
  stay unreachable.
- Explicit file links and background Bash. Both are in upstream, and background
  jobs can optionally continue the original session.
- Workspace session messaging. Upstream ADR 0239 already owns cross-session
  send, status, result and completion. The old fork `workspace.rs` is not
  replayed.
- Conversation-wide external filesystem write consent. Upstream collaboration
  does not grant that. It remains unported.

The next local release tag must match `vX.Y.Z-local.N`. The local update
provider rejects any other version or tag. Source on this branch still reports
upstream `0.24.0-beta.1` until that release is cut. `main` remains the
`0.21.0-local.4` snapshot.
