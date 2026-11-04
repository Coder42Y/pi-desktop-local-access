# Custom update delivery

## Status

NEXT-001 implementation candidate; not yet packaged or published. The user
approved making the entire Coder42Y/pi-desktop-local-access repository public
and prohibited client GitHub authorization. Visibility was changed to public
only after a bounded historical credential scan. Anonymous repository API and
Atom requests returned HTTP 200. No personal/production credential was found;
upstream localhost TLS test fixtures are not personal credentials. Pattern-based
scanning is not exhaustive; installers and images were not content-audited.

## Customization changelog — 0.21.0-local.2 candidate

- Pin checks and release-page navigation to the custom public repository.
- Track the `local` prerelease channel using semver tags `vX.Y.Z-local.N`.
- Explicitly disable downgrades after configuring the channel.
- Keep ad-hoc macOS installs manual even when Automatic was previously saved.
- Replace raw network errors with localized retry guidance; only fixed diagnostic
  categories enter updater logs. Raw headers, cookies, tokens, URLs and stacks
  never leave the updater error boundary.
- Verify generated update metadata against exact archive size and SHA-512.

No session, workspace, database, plugin or remote-access permission changes.
Workspace/host protocol version remains 0.21.0; electron-builder stamps the app
package with `build.extraMetadata.version`, currently `0.21.0-local.2`.

## Build and publication checklist (macOS required)

1. Use the candidate worktree on a native Mac with Node >=22.19, the pinned pnpm
   and Rust. Build dependencies from the frozen lockfile when absent.
2. Run the existing `pnpm --filter @pi-desktop/desktop dist:mac`. It builds the
   app/host/runtime and packages with `--publish never`; the final preflight must
   pass. An ad-hoc build is not Developer ID signed/notarized.
3. Verify the embedded app version, architecture, file preview/Finder actions,
   retained sessions and manual-update capability on macOS. Do not claim automatic
   installation qualification: this candidate deliberately does not support it.
4. Publish only after explicit release approval. Use tag `v0.21.0-local.2`, mark it
   prerelease, and attach the actual installer archives plus builder-generated
   `local-mac.yml`. Run `node scripts/check-custom-update-release.mjs <release-dir>`
   from the repository root; its JSON lists the exact metadata/artifact allowlist.
   Add separately verified SHA256SUMS.txt and sanitized BUILD-INFO.json. Never
   upload build directories, logs, configs, caches, credentials or user profiles.
5. The inherited upstream release workflow expects workspace-version tags and
   upstream signing credentials. It is NOT the custom publication route: do not
   push a custom tag to trigger it. Create the custom tag/release through the
   approved manual publication route after native verification instead.
6. Keep existing `local-v0.21.0-0/1` releases as archives, not channel candidates.
   All future custom versions must increase semver numerically and retain `local`.
7. Install the repaired build manually once. Old installed local.1 has stable-only
   discovery and cannot acquire this new channel policy just because the repository
   became public. Do not relabel an ad-hoc prerelease as stable to bypass that.
8. Check the published Atom feed and local-mac.yml anonymously, then check the
   installed candidate against current/newer versions and open the exact release.
   A failed/missing manifest must stay an error, never fall back to upstream.

The server can run controller/provider/metadata tests and JS checks. Native Mac
packaging, artifact upload, packaged discovery and installation remain separate,
explicitly unverified steps until real artifacts and macOS evidence exist.

## Verification

See [delivery design](../Process/custom-update-delivery/design.md) and its
acceptance records for commands, results and remaining gates.
