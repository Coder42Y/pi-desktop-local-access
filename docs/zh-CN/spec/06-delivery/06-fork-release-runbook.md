# Fork Release Policy

> [英文源规格](/spec/06-delivery/06-fork-release-runbook). The policy below is maintained in English.

Scope: `Coder42Y/pi-desktop-local-access` only. This policy takes precedence
for the fork's public Release asset selection over the upstream all-formats
[release runbook](06-release-runbook.md). It does not change the upstream matrix.

## 1. Seven primary packages

Use the compact five-installer layout of `v0.21.0-local.2`, plus the two Linux
pi-host bundles required for SSH. Publish these **seven primary packages**:

| Target | Asset name (`<version>` includes `-local.N`) |
|---|---|
| macOS Apple Silicon | `PI-Desktop-<version>-arm64.dmg` |
| macOS Intel | `PI-Desktop-<version>-x64.dmg` |
| Windows x64 | `PI-Desktop-Setup-<version>.exe` |
| Linux arm64 | `PI-Desktop-<version>-linux-arm64.AppImage` |
| Linux x64 | `PI-Desktop-<version>-linux-x86_64.AppImage` |
| SSH Host Linux arm64 | `pi-host-<version>-linux-arm64.tar.gz` |
| SSH Host Linux x64 | `pi-host-<version>-linux-x64.tar.gz` |

Do not publish extra installer formats by default: deb, rpm, system-Electron
ASAR, Windows portable EXE/ZIP or debug packages. Additional formats require an
explicit user request. Building a format does not authorize publishing it.

## 2. Runtime support files are not extra primary packages

Seven is the primary-package count, not permission to break integrity checks or
updates to force the entire GitHub asset list to seven entries.

- Both pi-host archives **must** have their named `.tar.gz.sha256` sidecars.
  Current SSH bootstrap fetches these exact URLs; an Actions checksum or a
  Release-body digest is not a substitute. Never remove checksum verification.
- Preserve the enabled updater's `local*.yml` feeds and every payload or companion
  file they require. In particular, the current macOS updater needs its ZIP
  payloads as well as the DMG installers. Merge and validate both architecture
  feeds before publishing. Never advertise a missing update payload.
- Anything outside the seven-package allowlist must be justified as an actual
  runtime dependency, or explicitly requested. Do not blindly upload `dist/*`.

An **exactly seven total assets** distribution would first require a separately
approved redesign of checksum/update delivery with regression coverage. This
policy does not authorize bypassing those contracts or disabling existing updates.

## 3. Keep engineering evidence in Actions

Keep per-target provenance JSON, global checksum reports, SSH qualification
records, build/debug logs and other intermediate outputs in Actions artifacts
or repository verification records, not as separate public Release assets.
Summarize verification and link the immutable commit/build run in Release notes.
Actions may retain a broader build matrix than the public Release allowlist.

## 4. Version, source and publication gates

1. Use a new semver `X.Y.Z-local.N` and tag `vX.Y.Z-local.N`. Refuse an existing
   tag or Release; never replace an old version or use upload `--clobber`.
2. Desktop package version, Electron `build.extraMetadata.version`, shared
   `APP_VERSION`, pi-host and native Host must agree on the full fork version.
3. Build all Desktop and pi-host targets from one immutable source commit.
   SSH downloads must resolve this fork and exact version, never upstream/latest.
4. Run applicable static, regression and native packaging checks. For SSH
   delivery, qualify a real authorized SSH target with isolated state: bootstrap,
   pairing, tunnel, strict schema and authorized/denied native mutations. Preserve
   `allowExternalWrites`, owner checks and conversation/Host consent.
5. Stage a new draft Release with an explicit asset allowlist. Compare local
   hashes/sizes and GitHub upload metadata, verify update-feed references and
   ensure both Host bundles/checksums exist before publishing the complete draft.
6. Release notes state the change, full source commit, build/verification links,
   signing status and any required explicit Host upgrade. Publication does not
   authorize replacing the user's running application or remote installation.

Do not trim or rewrite an existing Release merely to apply this policy. Changing
already-published assets requires a separate explicit user request.
