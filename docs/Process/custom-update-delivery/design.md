# Custom update delivery design

## Metadata
- Scope: NEXT-001; standard delivery.
- Base: docs/next-iteration-backlog at 855dcad (explicit user continuation base).
- The existing origin/main is an ancestor; no main integration is required.
- Approval: user approved the plan and public visibility, then required privacy review.

## Architecture and flows
Existing Renderer -> Preload -> Main -> electron-updater boundaries stay intact.
Main configures a fixed anonymous GitHub local channel and disables downgrades.
Settings/menu check -> controller -> GitHub Atom -> semver local release ->
local-mac.yml -> available state -> fixed custom releases page -> manual install.
No new persistence, public IPC fields, credentials or renderer URL inputs.

## Todo list
- [x] isolate-feed: align runtime and packaging with the custom local channel.
- [x] safe-delivery: clamp ad-hoc macOS to manual and sanitize all updater diagnostics/rejections.
### Checkpoint
Controller and policy regressions must pass, including saved automatic preferences.
- [x] metadata-gate: verify builder-produced local metadata against actual archive bytes before release.
- [x] synchronize-docs: record custom behavior, bootstrap and validation limits.
### Checkpoint
Lint, formatting policy (formatter disabled in biome.json), typecheck, build,
controller/provider/metadata tests and privacy audit must pass before delivery.

## Contracts and code touch list
- updater.ts: fixed configuration, safe diagnostics and IPC failures.
- update-policy.ts: ad-hoc macOS manual capability policy.
- custom-update.ts: fixed feed and safe localized diagnostics.
- local-update-provider.ts: real GitHub transport with local-only fallback and
  exact semver tag/manifest binding.
- update-cache-maintenance.ts: category-only diagnostics, no filesystem paths.
- desktop package.json/resources/app-update.yml: identical anonymous feed;
  extraMetadata.version is 0.21.0-local.2, workspace protocol version unchanged.
- metadata preflight script: builder-generated manifest, actual size/SHA-512,
  version/channel/name/architecture checks. No publication or credential access.
- focused controller/policy/real-provider tests and related specs/process docs.

## Testing strategy
Regression tests run against the previous code first. Mock only Electron and
network edges; use the actual installed GitHub provider for Atom/tag/metadata
selection. Use an isolated local HTTP executor fixture, never paid APIs or the
running user application. Offline dependency store reused, local output isolated.

### E2E scenarios
| ID | Path | Assertions |
|---|---|---|
| CUSTOM-01 | controller explicit check -> discovery -> open releases | custom source, local channel, no downgrade, macOS no download/install |
| CUSTOM-02 | failed check -> safe state/rejection/log -> retry | no raw headers/cookies/tokens; localized message; retry succeeds |
| CUSTOM-03 | actual GitHub provider -> Atom -> metadata | semver local tag, platform feed and current/new version selection |
| CUSTOM-04 | builder manifest -> archive verification | correct bytes pass; corrupt/mismatched/unsafe paths fail |

## Edge cases and errors
Environment GitHub credentials must not select a private provider. Channel setter
implicitly enables downgrade: explicitly disable it afterwards. All logger levels
and caught/emitted errors must retain only bounded diagnostic categories, never
raw messages. Manual errors without an emitted event must still settle state.
Old local-v tags remain archives; new tags use vX.Y.Z-local.N. Old installed
stable-only binaries need one manual bootstrap. Do not pretend public visibility
alone fixes channel/metadata or native signing.

## Implementation order and rationale
Tests -> fixed feed/policy/error repair -> metadata gate -> docs -> checks.
Use current controller seams; no broad refactor or new update transport.
Manual macOS installation is the approved safe fallback for ad-hoc signing.

## UI / mockups
No new layout or controls. Existing manual-mode and localized error UI is reused;
mockups and visual review are not applicable. No verify:ui:* commands authorized.

## Verification outcome

Implementation candidate verified on Linux; native macOS packaging and installed
application acceptance NOT RUN. No new installer, release, commit, push or merge.
See [acceptance evidence](acceptance.md). All optional browser visual review is
N/A: there is no layout change and the running user application was not touched.
No Superpowers skill was invoked. No second review pass was performed.
