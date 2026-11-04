# SSH Upload plugin UI delivery

## Metadata
Base: origin/main 51025d4. Supplied plugin 0.2.2; source UI candidate 0.2.3.
User explicitly approved prototype A and requested implementation plus commit.
No app baseline/version or production architecture change.

## Todo list
- [x] import-source: source-only plugins directory, provenance, ignore rules and test workspace.
- [x] compact-status: test before fix, extract read-only status view and align control styles.
### Checkpoint
Imported transfer/config/session tests pass; status regressions expose old UI.
- [x] preserve-behavior: success/failure/cancel/in-progress/context/local behavior stays intact.
- [x] verify-commit: browser/state tests, plugin validation, review, secret checks and local commit.

## Architecture and flows
Existing ComposerControl owns dialog/state; a small status view only displays
paste status and existing callbacks. No RPC, transfer or persistence path changes.
Paste bridge -> existing state listeners -> compact outcome SVG or existing
transient progress/actions -> same cancel/configure/resume handlers.

## Contracts
Manifest ID and permissions unchanged. Plugin manifest/package versions become
0.2.3 to distinguish source from imported 0.2.2. No packaged output committed.
Add a private test-only plugins workspace; runtime plugin has no npm dependency.

## Code touch list
plugins/ssh-upload/renderer/index.mjs and new status.mjs; plugin metadata;
plugins/tests; plugin collection README/AGENTS and workspace test dependencies.
Original main.js, transfer.cjs, paste-store.cjs, paste.mjs and workflow.mjs must
remain byte-identical to the uploaded source. Import documentation is retained
as historical evidence; machine-specific test literals are anonymized.

## Testing strategy
Node pure tests and actual React/Chromium component/browser tests with fixture
host RPC/SSH boundaries; no live app/host/credential reads. Baseline tests first,
then failing compact-status assertions, fix, existing workflow regressions.
Use existing Chromium and dependency store; missing browser test framework is
added as an exact test-only dependency. Formatter policy follows root Biome
(disabled); JS syntax, repository lint, plugin validation and docs checks apply.

### E2E scenarios
| ID | Path | Expected |
|---|---|---|
| UI-01 | remote idle control | gray aligned label, no leading arrow |
| UI-02 | pasted success/failure | adjacent SVG check/cross; accessible detail, no long visible summary |
| UI-03 | error cancellation | same callback; composer can recover |
| UI-04 | progress/configure/resume/session/local paths | controls and isolation preserved |

## Edge cases & errors
Do not label an unfinished transfer successful. Preserve transient percentages,
configuration/context warnings, resume and cancellation. Context-error text stays
visible when the remote context cannot be verified. No new async resources.

## Rationale
Do not modify a generic app tool card or guess plugin state from displayed text.
Only the actual user-authored plugin changes, using current host theme tokens.

## UI / mockups
The approved isolated variant A is the design reference; no new visual proposals
or generated mockups. Host app is not opened. Real installed-plugin acceptance
remains a later deployment gate.

## Verification outcome
24 pure Node tests and 4 actual React/Chromium browser journeys passed with
SSH_UPLOAD_REAL_TEST=0. Repository build, lint, Desktop typecheck, plugin DevKit
check, docs, architecture and policy checks passed. One read-only review found no
concrete blocker. Additional test coverage confirms Enter cancellation and the
extracted Resume action. Native installed-plugin/real SSH acceptance not run.
Local commit is the requested checkpoint; no push, merge, package or installation.
