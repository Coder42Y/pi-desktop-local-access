# Server Development Handoff

## Starting point

Repository: https://github.com/Coder42Y/pi-desktop-local-access (private).
Continue from `docs/next-iteration-backlog`, not `main`. This branch includes the
Finder feature, publication repairs and the next-iteration backlog. It descends
from the released candidate `dd1b2a5bc1206a2e67f33c2bce60587e84cb601a`.

```bash
git clone --branch docs/next-iteration-backlog \
  git@github.com:Coder42Y/pi-desktop-local-access.git
cd pi-desktop-local-access
git status --short
```

GitHub authentication/SSH keys must already authorize access to the private repo.
No credentials or machine-local configuration are stored in this document.

## Read next

- [Next iteration backlog](NEXT-ITERATION.md): update delivery and SSH-session
  experience. Both are queued, not implemented or approved for implementation.
- [Customization provenance](../../LOCAL_CUSTOMIZATION.md).
- [Finder implementation and verification](../Process/finder-file-menu/design.md).
- [Publication record](../Process/local-v0.21.0-1/design.md).
- Root `AGENTS.md` and applicable scoped rules before editing.

The user's latest instruction is to push this documentation for continuing work
on a server. It is not approval to expose the private repository, create a public
update repository, embed a GitHub token, merge the existing PR or begin either
backlog item without a new implementation request.

## Repository state

- `main`: original customized source snapshot `cb5be62`; intentionally unchanged.
- `feat/reveal-file-in-finder`: `dd1b2a5`, already pushed.
- PR #1: https://github.com/Coder42Y/pi-desktop-local-access/pull/1
  Last verified open/unmerged. Recheck current status before integrating.
- `docs/next-iteration-backlog`: adds NEXT-001 and NEXT-002 on top of the feature
  candidate. This is the continuation branch for the current handoff.
- `chore/release-asset-transfer`: temporary upload-only helper, not application
  development. Do not merge its replacement Linux workflow into main.

Do not merge task work into local main as a shortcut. Follow repository
branch/worktree and PR integration rules. Preserve unrelated changes.

## Delivered builds and feedback

- [local-v0.21.0-1](https://github.com/Coder42Y/pi-desktop-local-access/releases/tag/local-v0.21.0-1):
  app version `0.21.0-local.1`, all-directory local viewing plus Finder menu.
- [local-v0.21.0-0](https://github.com/Coder42Y/pi-desktop-local-access/releases/tag/local-v0.21.0-0):
  archived previous build, without the Finder context-menu action.

Each release contains complete macOS arm64 DMG/ZIP installers, SHA256SUMS.txt and
BUILD-INFO.json. Remote asset sizes and SHA-256 values were verified, and temporary
transfer chunks removed. Both are private customized prereleases, ad-hoc signed,
not Developer ID signed or Apple notarized. No Linux installer is implied by
moving development to a server.

The user installed the new build and confirmed sessions were retained and both
external-file preview and Finder actions work. The update-check 404 remains
unfixed; see NEXT-001. Use manual Release downloads for now.

## Verification baseline

The latest full local desktop suite for the released candidate completed with
4660 tests: 4657 passed, 0 failed, 0 cancelled, 3 skipped. Related tests, lint,
TypeScript checking, desktop build, architecture and documentation checks passed.
Remote JS, docs, PR-base, Windows Rust/transcript and trusted-extension checks
passed. Linux Rust CI exceeded its 30-minute limit and was cancelled. The user
approved prereleases while keeping PR #1 unmerged; do not describe all CI as green.

Earlier records of two scheduled-task label assertion failures are historical:
`dd1b2a5` updates those exact expectations to the established Session error text
without changing scheduled-task behavior.

## Development environment

Use the pinned pnpm version in package.json, Node >=22.19 and Rust; inspect current
manifests for exact requirements. Local macOS build caches, dependencies and
scratch worktrees are not transferred. On the server install from the frozen
lockfile; do not depend on the previous machine's absolute paths or symlinks.
Running Electron/native UI tests may require the project's Linux display setup.
macOS packaging and native Finder acceptance require a macOS environment.

## Next iteration boundaries

1. Update delivery: private anonymous feed access, prerelease/channel mismatch,
   missing update metadata, signature compatibility and verbose error disclosure.
   Distribution/authentication strategy remains undecided.
2. SSH experience: improve remote-session usability and interaction consistency,
   using Claude App as the experience benchmark. Clarify actual scenarios and
   scope first; this does not assert any particular Claude App SSH capability.

In PI-Desktop, Superpowers skills require explicit user opt-in. Ordinary planning,
debugging or implementation requests do not authorize auto-loading them. This is
a host-specific user preference, not a blanket change to other agent harnesses.
