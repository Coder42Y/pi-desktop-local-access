# Changelog

## 0.3.0 — unreleased candidate

- Fix manual insertion by dispatching from the trusted click after asynchronous
  preparation; keep configuration/session/generation and pending-save guards.

- Reuse explicitly confirmed connection metadata per stable SSH Host for new
  workspace projects; keep custom/default folders independent per project.
- Read saved configuration across conversations/reload instead of keying new
  workspace reuse to transient chat IDs.
- Preserve legacy records; require one confirmation for ambiguous old targets.
- Reject malformed/unknown inner settings formats and unsaved-state activation;
  serialize saves without losing other projects' records.
- Guard stale forms, upload admission/finalization and completed-result insertion
  against changed host/project/configuration identity.
- Keep legacy remote-history matching and existing permissions unchanged.
- SDK outer-file corruption/power-loss recovery and native deployment remain
  outside this plugin-only candidate.

## 0.2.3 — unreleased candidate

- Align the gray Composer label with adjacent controls and remove its leading arrow.
- Replace long settled upload summaries with adjacent SVG success/failure marks.
- Preserve status detail in accessible names/tooltips and retain failure cancellation.
- Keep transient progress, configure/resume and context warnings unchanged.
- No changes to transfers, configuration persistence, plugin ID or permissions.

## 0.2.2 — imported baseline

User-provided source adds remote-workspace-aware paste/drop upload, explicit
project target confirmation and workspace-contained remote paths. Existing tests
were imported; historical packaged outputs were not added to this repository.
