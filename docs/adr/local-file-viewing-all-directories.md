# ADR: All-directory local file viewing in a private build

- Status: Accepted for the user-requested local build only
- Context: A user explicitly requested unrestricted local-directory viewing after an absolute `Desktop/secmanus-smoke/paypal-lookalike.eml` link was rejected outside the project. The user approved source changes, tests and local macOS packaging.

## Decision

Electron's local file IPC adds filesystem disk roots to read/open/reveal containment and absolute chat reference containment. POSIX uses `/`; Windows uses drive-letter roots. These are not registered projects and never participate in fuzzy or shorthand lookup. Existing project, scratch and attachment priorities remain unchanged.

The application no longer uses project membership to authorize a local absolute file reference in this customized build. Any transcript local-file link can therefore refer to files outside the project. The renderer must still be trusted; this intentionally widens the host file-viewing boundary. OS privacy permissions and regular-file/type/size checks still apply.

No change is made to remote workspace dispatch, the local attachment-store detector, shared host-runtime defaults, plugin declarations/permissions, AI tool approvals or filesystem indexing. No database or protocol migration is required.

## Alternatives

- Register only the test directory: narrower, but explicitly rejected by the user's request for all directories.
- Add persistent per-directory grant UI: useful upstream, but outside the approved minimal local customization.
- Disable shared guards: rejected because it would also change remote/plugin consumers.
- Patch the installed asar/database: rejected in favor of source, regression tests and a separate package.

## Consequences and rollback

The change is a local security-policy customization, not a new upstream default. Upstream updates may overwrite it. Reinstalling an official build restores official containment behavior. Local packaging is separate from installation and does not replace the running application or user data. No upstream signing/notarization identity is available locally.

Verification lives in `apps/desktop/test/local-file-access.test.mjs`, which calls real IPC handlers against temporary external files and stubs only external services/native opening. Existing shared guard tests must continue to pass.
