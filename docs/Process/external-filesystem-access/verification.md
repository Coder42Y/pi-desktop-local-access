> Historical upstream-based implementation checkpoint. The personal repository
> PR is based on Coder42Y/pi-desktop-local-access main; its current evidence is
> recorded in ../workspace-session-messaging/pr-verification.md.

> Historical checkpoint before the approved session-name supplement and subsequent
> main refresh. Current candidate evidence is in ../session-name-resolution/verification.md;
> the earlier ADR numbering issue has since been fixed upstream.

# Verification record

## Candidate
- Branch: feat/workspace-session-messaging (same user request expanded explicitly).
- Worktree: /home/why/Pi-Desktop-worktrees/workspace-session-messaging.
- Base main: e551953357b6dc633ba64184736e297126445c5a.
- Candidate is the uncommitted working tree; no tested task commit is claimed.
- Code/test aggregate SHA-256: b272401901083d15795b06b1449f3633624c3010e909d3ac622a33367d54c673 (sorted changed/new paths;
  each encoded path NUL contents NUL).
- No data-schema migration, global permanent grant or plugin-capability bypass.

## Final candidate checks
| Check | Result |
|---|---|
| pnpm build:js | Pass after refresh, including docs site; usual Vite chunk warnings |
| pnpm lint / Desktop typecheck | Pass after refresh |
| cargo fmt --check / Clippy all targets | Pass; warnings in baseline code |
| pnpm check:pr-base / git diff --check | Pass |
| PermissionCard + remote bridges + collaboration tests | 43 pass; actual Chromium render/click has no skip |
| Native external Host RPC tests | 8 pass including visualization redirection |
| Native session tools | 10 pass |
| AgentHost / RACP full suites after review fix | 67 / 29 pass |
| Seven relevant JS-package suites before final base refresh | All passed; pi-host 4 platform/packaging skips |
| Local external-filesystem E2E | Pass on rebuilt final candidate |
| Two-Host RACP external-filesystem E2E | Pass on final candidate; earlier three consecutive repetitions passed |
| Existing workspace-messaging/collaboration/session-completion E2E | All pass on final candidate |
| Earlier Rust full suite before latest main refresh | 1150 pass, 1 ignored |
| Latest Rust full parallel run | NOT CLEAN: 1172 pass, 1 plugin-review redirect failure, 1 ignored |
| Redirect test alone | Pass |
| Latest Rust full serial run | INCOMPLETE: timeout after 420 seconds; 793 cases completed, stopped at unchanged session fork test |
| Session fork test alone | Pass in 0.04 seconds |
| Latest docs:check | BLOCKED by upstream duplicate upstream decision number; locale-pair check passes |

## Scope and reproducibility
Local E2E uses public tools.execute against a real temporary Rust Host and proves
reads do not prompt, initial Auto mutation cannot occur before consent, one grant
covers later Edit/Write/Bash, other sessions remain unapproved, and revoke/deny do
not mutate. Remote E2E runs two actual Rust processes, production Main relay,
owner-authenticated RACP and local SSE model; three external mutations follow one
scope prompt without transferring provider credentials or creating remote Agent
sessions. Chromium runs only the actual component on a temporary fixture page.

One initial remote harness run timed out; later runs (including three consecutive
repetitions and the final candidate) passed. Root cause was not proven. Fixture
assertions now return non-retryable HTTP 400 rather than masking errors as retryable
500, and deadline handling aborts the test runtime so cleanup can run. No claim of
fixing an unproven product race is made.

## Remaining validation limitations
Full Rust runs are not claimed green on latest main. The failing redirect and
stalled fork tests passed individually, but whole-suite interactions remain
unresolved and outside this change. A newly merged review fixture that assumed
Auto implied external approval was minimally updated to establish its explicitly
approved test scope; its denial fixture was not weakened.

Latest main contains both 0339-chat-file-refs-open-absolute-files-outside-managed-roots.md
and 0339-explicit-reviewed-file-actions.md, plus duplicate 0339 index entries.
This is present in HEAD, not introduced by the task. No unrelated ADR was renamed.
The docs site build passes, but docs:check does not. Native macOS/TCC, real SSH,
Windows, packaged release and the user's running Desktop were not exercised.
The authorization is in-memory per conversation/Host and clears on revoke or
Host restart; it is not permanent global trust. Existing OS permissions remain.

## Review and delivery
Independent review completed and one concrete P2 was fixed and retested; see
review.md. Main checkout's original untracked files were preserved. No commits,
pushes, PRs, tags, deployment, paid model calls or user-data tests occurred.
Implementation and targeted acceptance are complete; full validation is explicitly
not entirely clean. No further broad review or unrelated remediation was started.
