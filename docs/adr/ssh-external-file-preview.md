# ADR: Owner-only external SSH file previews

- Status: Accepted for the user-requested customization candidate
- Scope: Coder42Y customization; not an upstream policy change
- Related: [Local external viewing](local-file-viewing-all-directories.md),
  [Remote workspaces](local-agent-remote-workspace-tools.md)

## Context

The customized local viewer accepts explicit absolute files outside a project.
SSH workspace file views still reject them, so server-generated artifacts and
cross-checkout documents cannot be opened. A temporary worktree link can also
outlive the worktree and incorrectly appear as a scope error instead of missing.
The user explicitly approved matching local viewing, while preserving model,
plugin, mutation, search and project-instruction boundaries.

## Decision

Only the paired owner's file-view operations expand. workspace/files resolve
accepts external absolute references through non-searchable containment roots;
read/image accept the referenced filesystem root only for absolute inputs.
Relative paths and relative symlink escapes remain project-contained. List,
index, diff, instructions, project browsing, plugins and model tools are unchanged.
Shared helpers retain regular-file, OS-permission, MIME and size checks.

Legacy remote-Agent sessions do not expose their filesystem root to Desktop.
Add workspace/preview (owner, read-only) with sessionId, operation
(resolve/read/image), ref and optional mimeType. The Host derives the root from
the session and delegates to the same file-view service. Existing viewer
workspace/read and workspace/list retain their original scope. No canUseLocalTools
or local browser/plugin capability is granted; only read-capable sessions may
initiate preview UI requests, and server owner authorization remains definitive.

## Alternatives

- Change every remote project root to /: rejected; expands discovery and tools.
- Relax readWorkspaceFile or shared guards globally: rejected; changes viewer,
  plugin and tool contracts.
- Expose remote project paths in session resources: unnecessary public-state
  expansion; session-root derivation remains authoritative on the Host.
- Keep legacy previews unsupported: rejected for the requested SSH parity.

## Consequences

No storage migration or RACP version bump. Existing request shapes and viewer
roles remain intact; preview is additive and optional in the Host interface.
Older Hosts either lack the new method or keep the old workspace/files scope:
they fail without local fallback. Deploy matching candidate Desktop and pi-host
artifacts before expecting the new behavior. No in-place deployment is performed
by editing source, and no real credential or server permission changes are needed.

Owners can now preview any regular file the SSH OS account can read, including
sensitive files they explicitly name. This is a deliberate read-authority change,
not a guarantee that data stays on the server. Preview bytes cross the paired
connection into Desktop; tools do not receive new authority and preview is not
implicitly a model input. No arbitrary local OS opening or executable rendering.

## Validation

Regression tests for external text/images/missing/large files and OS denial;
relative/symlink containment, project-only index/instructions and plugin tests;
owner/viewer protocol tests; isolated React/Chromium plus real authenticated
loopback WebSocket and real filesystem journey for both SSH modes, stale-session
results and disconnected no-fallback. Native installed-app/real SSH release
acceptance remains a separate deployment gate.
