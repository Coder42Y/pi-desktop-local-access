# Fork SSH release alignment

## Scope
Repair the confirmed existing defect: installed Desktop 0.21.0-local.2 reports
shared APP_VERSION 0.21.0 and resolves SSH bundles from vastsa/PI-Desktop.
Release v0.21.0-local.3 from one immutable source commit, without replacing any
existing tag, Release or asset. Direct change; no architectural refactor.

## Contracts
Keep strict RACP schemas, owner-only workspace tools, allowExternalWrites,
conversation/Host consent and fail-closed native execution unchanged.
SSH bootstrap must resolve Coder42Y/pi-desktop-local-access at the complete
Desktop version for both published Linux architectures. Existing 0.21.0 Hosts
must fail version parity; daily startup does not silently upgrade or re-pair.
Users explicitly reinstall/repair the Host with the new Desktop.

## Todo list
- [ ] Align fork coordinates and all release version surfaces.
- [ ] Add URL/version and strict RACP authorization regressions.
- [ ] Build Desktop and Linux pi-host bundles from one SHA.
- [x] Align fork coordinates and all release version surfaces.
- [x] Add URL/version and strict RACP authorization regressions.
## Verification
Run fork/bootstrap/realignment/relay unit suites, pi-host and RACP tests,
workspace build, Desktop typecheck and lint. Real SSH verification uses a private
throwaway directory on the configured Linux arm64 Host, a fresh pairing, native
bundle, loopback forwarding and RACP Read/Write/Bash requests. Assert absent,
false and model-forged grants cannot authorize external mutations; explicit
owner grants do, unknown fields still fail schema validation. No model API,
production credentials or existing Host state is needed.

## Release
Manual fork workflow checks a new version/tag, gates packaging on tests, and
records SHA/version/checksums. macOS artifacts are unsigned and not notarized,
as with this fork's local distribution. Publication is explicit after verification.

## Candidate verification
Base main: 842840c09fd445f3a07d9583e770772a984c1911.
Workspace JS build, Desktop typecheck, lint and frozen install passed.
Targeted Desktop tests: 80 passed. RACP: 32 passed. Shared: 1376 passed.
pi-host: 75 passed, one platform-specific skip, using official Node 24.18.0.
Homebrew's relocatable-Node packaging failures were environmental; no packaging
implementation was weakened. Two unrelated Electron UI tests from an overly
broad glob could not run without the Electron binary; the release gate uses
the precise bootstrap, relay, RACP and updater suites instead.
One independent read-only review found two SSH acceptance isolation/cleanup
defects, both fixed before commit. Native archive/SSH qualification is pending
the same-commit release artifacts.
