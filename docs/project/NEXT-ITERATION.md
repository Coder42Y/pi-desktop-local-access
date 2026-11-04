# Next Iteration — Customized PI-Desktop

This backlog tracks the Coder42Y customization, not the upstream project's
historical milestones. Recording an item does not authorize implementation,
repository visibility changes, remote publishing or a release.

## Queue

| ID | Item | Status | Target version |
|---|---|---|---|
| NEXT-001 | Restore reliable update discovery and delivery for customized builds | Implementation candidate; native packaging/release pending | 0.21.0-local.2 candidate |
| NEXT-002 | Reuse saved SSH connection configuration across conversations and application restarts | Backlog — requirements recorded; not started | To be scheduled |
| NEXT-003 | Quote any selectable text in the composer with explicit model-facing quotation semantics | Backlog — requirements recorded; not started | To be scheduled |

## NEXT-001 — Customized-build update delivery

> Current candidate and approved public-distribution decision:
> [Custom update delivery](CUSTOM-UPDATE-DELIVERY.md). The observations and planning
> notes below are the original intake snapshot, not current implementation status.

### Observed problem

At intake, the installed `0.21.0-local.1` build failed update discovery with HTTP 404 when
requesting `https://github.com/Coder42Y/pi-desktop-local-access/releases.atom`.
The source/release repository is private and the updater is using anonymous
GitHub release discovery. GitHub CLI authentication is not automatically shared
with the desktop application.

Current updater code explicitly sets `allowPrerelease = false`, while both
custom releases are prereleases. Published assets include installers, checksums
and build information but not the update-feed metadata required by the updater.
These are additional delivery gaps, separate from the immediate 404.

The UI displays the raw error message, including HTTP response headers and
Set-Cookie content. Future error handling must present a concise localized
message and redact sensitive transport details from UI and logs. Do not copy
actual cookie values, tokens or raw response headers into this backlog.

This issue affects update discovery/delivery; it does not by itself indicate
workspace, session or plugin corruption. The user confirmed the installed
customization's external-file preview and Finder menu work successfully.

### Scope to plan

- Decide between authenticated private distribution and a public installer-only
  update repository while keeping source private. The public distribution
  repository is a candidate, not an approved decision or permission to publish.
- Align custom version identifiers, release tags, prerelease eligibility and
  feed selection; retain a clear distinction from official upstream releases.
- Generate and publish the required update metadata alongside matching archives
  and integrity information.
- Verify macOS download and installation behavior with the actual signing policy.
  Ad-hoc signing and the absence of notarization must not be treated as proven
  automatic-install compatibility.
- Simplify update errors and sanitize secrets, Cookie/Set-Cookie values and
  verbose response headers before exposing diagnostic text.

### Proposed acceptance criteria

- Discover the next eligible custom version from the selected distribution
  source without the current anonymous-private-feed 404.
- Verify channel selection, download integrity and metadata/version consistency.
- Validate safe installation under the chosen signing policy, or explicitly
  fall back to a clear manual-download flow when automatic installation is not
  supported; do not claim automatic updates work until tested end to end.
- Never embed a personal GitHub token in an installer or silently switch to the
  upstream feed and overwrite customization features.
- Keep errors concise and localized, with no credential or cookie disclosure.
- Preserve workspace, session, configuration and plugin behavior.

### Interim workaround and boundaries

Manually download installers from the private GitHub Releases page. No updater
code, credentials, repository visibility or distribution policy changes are
included in this documentation task. Implementation and target version remain
unapproved and unscheduled.

## NEXT-002 — SSH remote-session experience

### Product objective

Improve the usability and interaction consistency of SSH remote sessions,
using Claude App as the experience benchmark.

### Recorded requirement — configure once, reuse after restart

The SSH connection entry (referred to by the user as the SSH plugin) should
retain a completed connection configuration. Once configured, the user should
not need to configure it repeatedly inside the conversation dialog, including
after quitting and restarting the application.

### Proposed acceptance criteria

- Configure an SSH target once and use it in a conversation.
- Reopen the conversation or use the same configured target in another
  conversation without repeating the setup dialog.
- Quit and restart the application; the saved target configuration is still
  available without re-entering the same configuration.
- Reuse the configuration for the correct target; do not mix different hosts'
  settings or silently broaden remote-access permissions.
- Preserve secure credential handling. This requirement does not authorize
  plaintext secret storage or bypassing required authentication/key unlocking.

### Planning boundary

The concrete gap is configuration reuse, not a commitment to automatic
connection, a permanently live SSH session or a complete reconnection redesign.
The specific connection entry, configuration ownership and remaining interaction
details must be checked against the code before implementation. Claude App
remains an experience benchmark, not a claim about its SSH capabilities.
This is backlog documentation only; implementation has not started.

## NEXT-003 — Quote selected text into the composer

### Product objective

Allow the user to select text and quote it into the conversation composer,
then send it to the model as clearly identified quoted content.

### Recorded requirements

- Support text selected from model replies and from the user's own messages.
  The scope is not limited to those message roles: any selectable text in the
  application's accessible UI may be quoted.
- Insert the selected text into the composer as a quote that is included when
  the user sends the message.
- Present the quote as a text passage enclosed in quotation marks, with a
  subtle gray background. No elaborate card or broader visual redesign is
  requested.
- Make the quotation explicit in what the model receives, not only in visual
  styling. The model must be able to distinguish quoted material from the
  user's surrounding request. Quoted text must not acquire a higher-priority
  instruction role merely because it was quoted.

### Proposed acceptance criteria

- Select text in a model reply, invoke Quote, and see that text appear as a
  quoted passage in the composer.
- Repeat with a user message and other selectable text; quotation is not
  restricted to model answers.
- Before sending, the quote is recognizable through quotation marks and a
  subtle gray background, retaining the selected text.
- Send a message containing a quote and an accompanying request; the model's
  input explicitly marks the quoted passage and separates it from the request.
- The quote remains explicit without relying on background color reaching the
  model. Plain text must not be silently rendered as a quote but sent without
  any quotation indication.

### Planning boundary

The selection action's placement and keyboard behavior, exact message encoding,
multiline presentation and behavior across restart are not specified yet. Do
not infer arbitrary system-wide selection access or additional OS permissions
from this backlog item. No implementation or protocol/UI changes are started.

## Scheduling

NEXT-001 has an approved implementation candidate and public distribution source.
Native macOS packaging, installed-build acceptance and publication remain pending;
see the custom update runbook above. NEXT-002 and NEXT-003 are queued with the
requirements above recorded. Priority, implementation order and target versions
remain to be scheduled; this documentation change does not authorize execution.
