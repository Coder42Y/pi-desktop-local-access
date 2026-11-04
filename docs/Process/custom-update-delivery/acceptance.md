# Acceptance

- A1: No client credentials; discovery and release links use only the custom repository/local channel; no downgrade.
- A2: ad-hoc macOS never downloads or installs automatically, including restored automatic preferences.
- A3: failures through events, rejections and diagnostics disclose no transport details; retry remains usable.
- A4: publication preflight rejects missing/mismatched metadata or archive integrity.
- A5: existing workspaces, sessions and plugin permissions are untouched.

## Sign-off

Subsequent user authorization: commit and push this candidate branch only.
No release, tag, PR, main merge or build-pipeline implementation is authorized
by that checkpoint request. Earlier no-commit/no-push statements below describe
the implementation verification snapshot before this checkpoint.

Linux implementation verification complete; native-release acceptance pending.

| Criterion | Evidence | Result |
|---|---|---|
| A1 | Actual installed GitHub transport with strict local adapter; custom provider/controller/config tests; anonymous GitHub HTTP 200 | Pass at service boundary; packaged check NOT RUN |
| A2 | Mac controller public check, saved automatic preference, unsupported download/install guards and Windows automatic regression tests | Pass |
| A3 | Emitted/rejected failures, timeout/retry, all logger levels, OS release opening and cache failure regressions with synthetic private markers | Pass |
| A4 | 14 metadata/packaging subprocess tests, checksums/sizes/names/path rejection/architecture flag forwarding and sanitized YAML error | Pass with synthetic archives; real Mac artifacts NOT BUILT |
| A5 | No persistence/session/plugin production code changes; full desktop suite | Pass for changed surface; real installed app NOT TOUCHED |

Task candidate: `855dcad57138358f2c0ec8109d4b7aeb88b354c4` plus the local diff.
Base main: `cb5be62757680322d1d45a6a187df0a0b4652aee` (fetched, ancestor).
Tested changed-code SHA-256 (sorted path NUL bytes NUL, excluding docs):
`8aed155a499ba67e84f6ccbfc827192c865652a2fd2330fffe47967d116e1f7e`.

### Commands actually run

- `pnpm lint`: pass (Biome lint and style tokens). Biome formatter is explicitly
  disabled by repository config; no separate formatter command is configured.
- `pnpm build:js`: pass including desktop main/preload/renderer and VitePress.
- `pnpm --filter @pi-desktop/desktop typecheck`: pass.
- `(umask 022; pnpm --filter @pi-desktop/desktop test)`: 4,675 total,
  4,652 passed, 0 failed, 23 skipped (platform/display-dependent cases).
- `node --test scripts/check-custom-update-release.test.mjs`: 14 passed.
- `pnpm --filter @pi-desktop/i18n test`: 31 passed.
- `pnpm docs:check`: 86 locale pairs and 611 pages passed (before the final
  evidence record was added; rerun at closeout).
- `node scripts/check-architecture.mjs`: passed; rerun at closeout.
- `node scripts/check-agent-policy-sync.mjs`, `pnpm check:pr-base`,
  `git diff --check`: passed.
- Anonymous requests to repository API and releases.atom: HTTP 200 after the
  user-authorized visibility change. No client auth was configured.

### Baselines and remediations

Six initial regressions failed on the original code. An independent read-only
review then identified channel fallback, version binding, packaging flags,
preflight error output, cache diagnostics and public rejection gaps; all were
fixed with regressions and retested. Three additional regressions were observed
failing before the strict-provider/cache corrections. No second review pass.

The first full build exposed an existing dead VitePress handoff link; only that
link was repaired. The first full desktop run under server umask 0077 had one
unrelated storage fixture permission assertion failure (0400 vs 0444). The storage
source/tests were unchanged; the 32-test suite passed with subprocess umask 022,
and the final full suite used that same standard fixture environment. The host
umask and storage implementation were NOT changed.

### Privacy and delivery limits

The authorized audit checked all remote branch/tag history: 7 reachable commits,
3,805 blobs; no potential production/personal credentials identified. Known
upstream localhost test certificate/key fixtures were identified as test-only.
Both release BUILD-INFO assets were checked without credential/path matches.
Pattern-based scanning is not exhaustive; existing installers, images/media,
PR-only/unreachable objects, workflow artifacts and issues were not audited.
Only public repository visibility changed remotely; no source or asset uploaded.
Changed code was additionally scanned for common private-key/token formats.

Skipped: native macOS packaging/signing/install/discovery E2E (Linux host),
Rust suites (no Rust changes), `verify:ui:*` (not authorized, no layout change).
The server integration tests exercise the real provider and isolated packaging
subprocess, not a running Electron application. The Mac release gate remains
BLOCKED on a native Mac environment and explicit publication approval. This is
not a claim that automatic installation or the existing local.1 binary works.
