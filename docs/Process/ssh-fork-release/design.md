# Fork SSH release alignment

## Scope and root cause
Confirmed existing defect: installed Desktop 0.21.0-local.2 contained
APP_VERSION 0.21.0 and resolved SSH bundles from vastsa/PI-Desktop. The live
Linux arm64 Host was the official 0.21.0 package. Its strict schema rejected
the fork's owner authorization field. The previous fork Release had no pi-host
assets. Direct release-coordinate/version repair; no architectural refactor.

## Contracts
Preserve strict RACP schemas, owner-only workspace tools, allowExternalWrites,
conversation/Host consent and fail-closed native execution. SSH resolves
Coder42Y/pi-desktop-local-access at the complete Desktop version for both
published Linux architectures. Existing official/older fork Hosts fail exact
version parity; daily startup does not silently upgrade or re-pair.

## Todo list
- [x] Align fork coordinates and all release version surfaces.
- [x] Add URL/version and strict RACP authorization regressions.
- [x] Build five Desktop targets and both Linux pi-host bundles from one SHA.
- [x] Verify checksums, actual packaged Desktop, real SSH and publish a new Release.

## Delivery and provenance
- Base main: 842840c09fd445f3a07d9583e770772a984c1911.
- Implementation: 0cd1eb1d9512469a76b456eab233d780e5c1dc2d, PR #6.
- Build/source/tag commit: f52499b5d3d28da7249baee4fb177b20d5776c35.
- Native build: https://github.com/Coder42Y/pi-desktop-local-access/actions/runs/42144593235
- Main CI: https://github.com/Coder42Y/pi-desktop-local-access/actions/runs/42144590553
- Release: https://github.com/Coder42Y/pi-desktop-local-access/releases/tag/v0.21.0-local.3
- 35 new assets: installers, updater feeds, both Linux pi-host archives/checksums,
  per-target provenance, global SHA256SUMS and SSH-VERIFICATION.json.
- All asset sizes and SHA-256 digests were compared with GitHub's upload responses
  and then checked again through Release metadata before publication.
- macOS packages are unsigned/not notarized. No existing Release/tag/asset was
  overwritten. The published tag remains pinned to the native build commit.

## Verification
Workspace JS build, Desktop typecheck, lint and frozen install passed.
Targeted Desktop tests: 80 passed. RACP: 32 passed. Shared: 1376 passed.
pi-host: 75 passed, one platform-specific skip, using official Node 24.18.0.
Main CI passed all four jobs, including Linux/Windows Rust and Trusted Extensions
Electron E2E; all eight release jobs (verify plus seven native targets) passed.

Packaged macOS arm64 app.asar was inspected: package version and APP_VERSION
are 0.21.0-local.3; the bundled SSH resolver uses the fork repository and full
version. Both macOS updater feeds were merged and validated against the actual
artifact sizes and SHA-512 values.

Real Linux arm64 SSH acceptance passed twice, using the native release archive:
1. Verified local archive upload, following the production .upload.*/artifact.tar.gz
   path contract, then production bootstrap.
2. Production bootstrap downloading the published fork HTTPS URL directly.

Both exercised fresh pairing, loopback forwarding, version/Host identity,
external Read, absent/false/model-forged grant rejection, unknown-field/type
schema rejection, authorized Write/Edit/Bash, reconnect and isolated cleanup.
Archive SHA-256: 381f1058015f5756cb1b0887781a180a4f47aa44f1cf237f7f39b09f12340e1b.
No model provider was used. Existing remote installation, device credentials,
projects and user sessions were not modified; the running Desktop was not replaced.
Public checksum and merged local-mac.yml URLs were fetched successfully.

## Review and environment findings
One independent read-only review found acceptance isolation and cleanup defects:
explicitly isolate PI_DESKTOP_DATA_DIR and read the actual pi-host.pid filename;
wait for process exit before removing the temporary HOME and reporting success.
Both were fixed and exercised by the real SSH runs. A subsequent actual run
caught the upload fixture's path mismatch; only the acceptance script was fixed,
not bootstrap's strict path validation. The script/documentation follow-up does
not change the shipped Desktop/pi-host executable source or move the release tag.

Homebrew Node 26 could not run after being copied without its dylib; packaging
tests passed with the checksum-verified official Node 24.18.0 binary. Two unrelated
local Electron UI tests from an overly broad glob initially could not run without
the Electron binary; the precise release gate and main CI subsequently passed.
Transient upload TLS failures were resolved by transmitting only missing assets
serially over HTTP/1.1; already uploaded files were verified, never overwritten.

## Compatibility
Install the new Desktop and explicitly install/repair the SSH Host using the
matching fork release. Daily SSH readiness is not an updater. Publication did
not restart or replace the user's existing Desktop or official remote Host.
No remaining delivery blockers. Real SSH execution was qualified on Linux arm64;
Linux x64 was natively built and package-tested, not exercised on a live x64 SSH Host.
