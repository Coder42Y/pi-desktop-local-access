# Next Iteration — Customized PI-Desktop

This backlog tracks the Coder42Y customization, not the upstream project's
historical milestones. Recording an item does not authorize implementation,
repository visibility changes, remote publishing or a release.

## Queue

| ID | Item | Status | Target version |
|---|---|---|---|
| NEXT-001 | Restore reliable update discovery and delivery for customized builds | Published; installed macOS update flow still needs confirmation | v0.21.0-local.3 |
| NEXT-002 | Reuse saved SSH connection configuration across conversations and application restarts | Merged for new SSH workspaces; native Desktop restart acceptance pending | Merged in PR #5 |
| NEXT-003 | Quote selected text in the composer, starting with model replies | Merged in PR #9; release candidate | v0.21.0-local.4 |
| NEXT-004 | Align and de-emphasize the SSH Upload indicator with explicit success/failure icons | Merged; installed-plugin UI acceptance pending | Merged with the SSH Upload source |
| NEXT-005 | Adopt upstream local file-link handling and retain fork SSH previews | Merged in PR #10; release candidate | v0.21.0-local.4 |
| NEXT-006 | Adopt upstream background Bash controls under fork authorization | Merged in PR #11; release candidate | v0.21.0-local.4 |
| NEXT-007 | Bring upstream Computer Use to the fork | Local candidate; pending fork integration | To be scheduled |
| NEXT-008 | Bring upstream Composer model picker to the fork | Local candidate; pending fork integration | To be scheduled |
| NEXT-009 | Bring upstream plugin launcher grid to the fork | Local candidate; pending fork integration | To be scheduled |
| NEXT-010 | Bring upstream native Review panel to the fork | Local candidate; pending fork integration | To be scheduled |

## NEXT-001 — Customized-build update delivery

> [v0.21.0-local.3](https://github.com/Coder42Y/pi-desktop-local-access/releases/tag/v0.21.0-local.3)
> is published with validated update metadata. The remaining check is discovery
> and manual update handoff from an installed macOS build. The ad-hoc macOS
> distribution uses manual installation. See [release evidence](../Process/ssh-fork-release/design.md)
> and [custom update delivery](CUSTOM-UPDATE-DELIVERY.md). The notes below are
> the original intake snapshot.

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

> Shared SSH Upload profiles are merged for new SSH workspaces. The
> [acceptance record](../Process/ssh-upload-profile-reuse/acceptance.md)
> covers persistence across cold plugin processes. Native Desktop restart
> acceptance remains open. Legacy remote sessions retain their existing
> per-context behavior.

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

## NEXT-003 — Quote selected text into the composer

### Product objective

Allow the user to select text and quote it into the conversation composer,
then send it to the model as clearly identified quoted content.

### Recorded requirements

- Start with text selected from a model reply. Quoting from user messages and
  other selectable in-app text remains a follow-up.
- Add the selected passage as a separate quote in the current conversation's
  composer. Preserve existing draft text and attachments. Removing the quote
  leaves the rest of the draft intact.
- Send the quoted passage together with the user's request when the user
  explicitly sends. Adding or removing a quote never sends a message.
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
- Start with an existing draft, add a quote, and remove it independently.
  Verify that the original draft is intact and no message was sent.
- Before sending, the quote is recognizable through quotation marks and a
  subtle gray background, retaining the selected text.
- Send a message containing a quote and an accompanying request; the model's
  input explicitly marks the quoted passage and separates it from the request.
- The quote remains explicit without relying on background color reaching the
  model. Plain text must not be silently rendered as a quote but sent without
  any quotation indication.

### Planning boundary

Reuse the current transcript selection menu and the per-session composer draft
and send paths. The [retired upstream quote](https://github.com/vastsa/PI-Desktop/pull/464)
provides reference code for extracting selected text and formatting Markdown.
It appended plain draft text, so the independently removable quote needs its
own draft state. See the [Composer spec](../spec/04-ux/08-component-spec.md#quote-selected-model-text-fork-next-003)
for the implemented draft and submission behavior.

## NEXT-004 — SSH Upload indicator presentation

> The compact indicator is merged. The [UI acceptance record](../Process/ssh-upload-plugin-ui/acceptance-ui.md)
> covers alignment, outcome icons, and accessible labels. Installed-plugin
> acceptance remains open.

### Observed feedback

The current screenshot shows an upward-arrow SSH Upload label with a separate
secondary status line. The user finds this presentation visually abrupt beside
other conversation elements.

### Recorded requirements

- Keep the label `SSH Upload`, styled in a subdued gray rather than visually
  prominent text.
- Align the label and row with neighboring conversation elements, using their
  established spacing and baseline instead of a detached-looking block.
- Put the upload status icon to the right of the label: a green check icon for
  success, or a red cross icon for failure.
- Use the application's actual icon components or SVG assets, not emoji or
  platform-dependent emoji glyphs. Icon sizing and baseline should fit the row.
- Provide an accessible status name so color and icon shape are not the only
  way to distinguish success from failure.

### Proposed acceptance criteria

- The SSH Upload row shares the surrounding elements' alignment and visual
  density; the label is gray and does not dominate the conversation.
- Success and failure display the matching green check/red cross on the right,
  using icons rather than emoji.
- Upload outcome is represented correctly without changing transfer behavior.

### Planning boundary

The shipped source change is limited to status presentation. Transfer behavior
and the existing progress and cancellation controls retain their semantics.

## NEXT-005 — Local file links and SSH previews

- Adopt the upstream local resolver for explicit absolute file links,
  including extensionless files, and route explicit directory links to the
  file manager. Keep the fork's Finder reveal action. Read project-external
  images only on explicit open, with no automatic inline load.
- Keep the fork's owner-only SSH side-panel preview for remote text and images,
  including explicit absolute paths outside the project. Preserve both SSH
  session routes, remote Host identity, and the existing scope for relative
  paths, directory listing, and search. A remote failure must not fall back to
  the local filesystem.
- Check the local and SSH paths separately with a compatible Desktop and
  `pi-host` pair. The SSH preview is already implemented. This item covers
  preserving it while integrating local behavior.

Sources: [upstream absolute links](https://github.com/vastsa/PI-Desktop/pull/2097),
[upstream directory links](https://github.com/vastsa/PI-Desktop/pull/2118),
[fork SSH preview](../adr/ssh-external-file-preview.md).

## NEXT-006 — Background Bash under fork authorization

- Adopt upstream `TaskList`, `TaskWait`, and `TaskStop` for background Bash
  in local Agent sessions. Resolve task IDs within the current session.
- Route launch through the fork's existing conversation-and-Host filesystem
  consent before the process starts, including in Auto mode. Keep the
  initiating authorization ceiling for delegated work.
- Track SSH background-job controls separately. The upstream job-management
  path applies to local Agent sessions.

Sources: [upstream background jobs](https://github.com/vastsa/PI-Desktop/pull/2115),
[fork filesystem consent](../adr/external-filesystem-conversation-consent.md).

## NEXT-007–010 — Upstream Desktop features

The four features have a local candidate on `feat/upstream-desktop-features`.
Track them independently. Fork `main` does not contain the candidate.

| ID | Feature | Integration scope |
|---|---|---|
| NEXT-007 | [Computer Use](https://github.com/vastsa/PI-Desktop/pull/2103) | Keep opt-in settings, OS permissions, the visible run indicator, and Stop. Confirm the supported native platform. |
| NEXT-008 | [Composer model picker](https://github.com/vastsa/PI-Desktop/pull/2134) | Bring search, provider filters, and the Models settings shortcut into the fork's existing settings layout. |
| NEXT-009 | [Plugin launcher grid](https://github.com/vastsa/PI-Desktop/pull/2091) | Bring the grid, pins, and recent items for plugins and installed apps. Keep launcher-only authority for opening local apps. |
| NEXT-010 | [Native Review panel](https://github.com/vastsa/PI-Desktop/pull/2017) | Bring round history, reviewed-file actions, and guarded rollback. Preserve fork filesystem consent and stored conversation data. |

## Scheduling

The queue records the current status. Priority, implementation order, and
target versions for the open feature work remain to be scheduled. Recording
these items does not authorize implementation, integration, or a release.
