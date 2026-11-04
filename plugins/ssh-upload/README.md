# SSH Upload for PI-Desktop — 0.3.0 candidate

User-authored standalone plugin, imported from the supplied 0.2.2 source archive.
This candidate retains the compact Composer UI and adds server-level connection
reuse with independent project upload folders for new SSH workspace projects.
It is not installed, packaged or published by this source change.

## Behavior

In an SSH workspace or legacy remote conversation, paste or drop regular files
into the Composer. The plugin transfers their bytes over system SSH, verifies
size/SHA-256 and replaces its placeholder with remote paths. It preserves the
rest of the draft and never automatically sends a message. Local conversations
and ordinary text paste retain normal application behavior.

The 0.2.3 control has no leading arrow. Successful automatic upload shows a green
vector check; failed automatic upload shows a red vector cross that retains the
existing Cancel pasted upload action. Detailed status remains in the accessible
name and tooltip rather than a second long visible line. Receiving/uploading
progress, configure/resume actions and unverified-context warnings remain visible.
English and Chinese labels follow the existing locale catalog.

## Configuration and security

Configure a system SSH alias or user@host, optional port and identity-file path.
Only non-interactive key/agent authentication is supported. No password is stored
and the plugin does not reuse Desktop's saved host/password records. Confirm the
host fingerprint in Terminal first; StrictHostKeyChecking=yes remains enforced.
Encrypted keys must already be unlocked by the user's SSH agent.

For new SSH workspace projects, save the connection once for the selected
server. Other projects on that same stable Host reuse the SSH alias, optional
port and identity-file path. Each project derives its own .pi-desktop/uploads
folder from current public project/get metadata; custom folders remain relative
to that project's root. Connections and project folders are separate, versioned
plugin settings. No password or private-key contents are collected.

New conversations and plugin/application reloads do not use a conversation ID as
the new workspace profile identity. A changed server binding never silently
borrows another server's target or custom directory. Changing a shared connection
intentionally affects that server's projects; the dialog explains this scope.

Old per-context profiles are retained for compatibility. They do not prove a
stable Host identity, so an unmapped old target is only suggested and requires
one explicit confirmation/save before server-wide reuse. Do not uninstall to
migrate. Existing valid legacy remote: histories retain their previous matching
rules; their API lacks sufficient root metadata for the new automatic behavior.
No new Desktop or remote Host metadata interface/permission was added.

Writes read current settings, merge under one plugin-owned queue, validate and
check the active binding before one SDK setSettings call. Unknown inner storage
versions or malformed profile strings are errors, not empty replacement data.
Unknown legacy record fields are preserved but excluded from renderer config.
Write failure does not enable the proposed unsaved configuration. Active uploads
block saves; snapshots and completed-result insertion are checked against their
original binding/configuration identity. Both lexical and physical transfer-path
checks remain enforced.

The plugin uses the existing SDK storage, not an independent config file. The
current host SDK silently returns defaults if its outer settings.json is corrupt
and does not promise an atomic outer-file write. Plugin-only changes cannot
identify or repair that host-level condition or guarantee power-loss recovery.
The isolated cold-process test verifies the plugin's save/read behavior over a
temporary file-backed SDK boundary, not native installed Desktop restart.

## Operations and limits

- Open the control for manual selection/upload, or paste/drop in the Composer.
- Unconfigured remote projects block file handling and show Configure SSH,
  rather than creating an unintended local attachment.
- Files are staged privately in 44 KiB chunks before streaming through SSH.
- One batch, up to 20 regular files; automatic transfer limit is 2 GiB per file.
- Successful files get a fresh private pi-upload-UUID directory; existing remote
  files are never overwritten. Credential-like filenames are rejected.
- Failed/pending placeholders block send until cancelled or recovered. Cancelling
  aborts transfer and removes local staging. Remote partial files may remain;
  they are never inserted as verified successes.
- Switching sessions does not insert paths into another draft. Return to the
  original session and use Insert uploaded paths when a completed job is detached.
- Directly choosing files uses disk streaming and avoids per-chunk browser RPC
  staging overhead. Native attachment-picker events are not intercepted.
- No-progress receive timeout: 2 minutes; stale private staging cleanup: 24 hours.
  SSH connect timeout: 15 seconds; per-file transfer timeout: 60 minutes.
- Remote tools required: POSIX shell, cat, mkdir, mv and sha256sum or shasum.

## Permissions and compatibility

renderer.extension is used for the Composer control/dialog, draft snapshots and
file paste/drop events. desktop.control is high privilege; this plugin uses it
only for read-only project/get metadata. Direct Node capabilities access selected
files/private staging and start system SSH/file selection. These permissions do
not constitute a Node process sandbox; install only trusted source.

The plugin registers no arbitrary-path AI upload tool, imports no private app
modules and does not modify the app bundle. Minimum Desktop version: 0.21.0.
Automatic handling depends on the existing Composer DOM integration; unknown
future editor/send paths are not claimed to work without adaptation.

## Validation and installation boundary

From the repository root:

```sh
pnpm --filter @pi-desktop/user-plugins test
SSH_UPLOAD_REAL_TEST=0 SSH_UPLOAD_TEST_BROWSER_EXECUTABLE=/path/to/chromium pnpm --filter @pi-desktop/user-plugins test:ui
node packages/plugin-devkit/dist/cli.js check plugins/ssh-upload
```

Normal tests use synthetic temporary files, fixture host APIs and fake SSH
transports executing the transfer script locally. Browser tests use isolated
profiles and actual React/paste/drop behavior, not the running user app. The
archive's historical real-SSH smoke report was not rerun for this UI candidate.
Real SSH is strictly opt-in and requires separate approval.

The imported .piplug archives and machine metadata are intentionally not tracked.
If packaging is later requested, use the official plugin DevKit/PluginPack and
validate its output; do not hand-assemble an archive. Install an update over the
same plugin ID rather than uninstalling first to preserve existing plugin data.
Installation and user-app acceptance have not been performed here.
