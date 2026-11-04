# User-authored PI-Desktop plugins

This directory stores the repository owner's independently authored plugins.
It is separate from the application's bundled plugins under
apps/desktop/resources/plugins. Adding source here does not install or activate
it in Desktop, and does not change application permissions.

## Layout

- `ssh-upload/`: SSH Upload plugin source, imported from the supplied 0.2.2 archive.
- `tests/`: regression tests for these plugins.
- New user-authored plugins belong in `plugins/<plugin-directory>/`.

Keep only source, tests and documentation. Do not commit plugin runtime data,
SSH settings, host profiles, credentials, private keys, node_modules or .piplug
builds. Original distributed archives are deliberately excluded.

## Checks

From the repository root after the normal workspace dependency setup:

```sh
pnpm --filter @pi-desktop/user-plugins test
SSH_UPLOAD_TEST_BROWSER_EXECUTABLE=/path/to/chromium pnpm --filter @pi-desktop/user-plugins test:ui
node packages/plugin-devkit/dist/cli.js check plugins/ssh-upload
```

The default browser fallback is an installed Chrome channel; no browser is
downloaded automatically by these commands. Pure tests join recursive workspace
tests; browser tests remain a separate, explicit acceptance command. Browser
fixtures and fake SSH transports do not use user profiles or credentials.
Real SSH smoke testing is opt-in via SSH_UPLOAD_REAL_TEST and is not part of
routine verification. Never enable it against a user host without approval.

## Provenance and current candidate

User-supplied archive: pi-desktop-plugins.zip, SHA-256
`8fbfbf27899bc947810b6e6c388f53e6838d0f634895e2b6b1478e67db122909`.
Imported source/tests only; macOS metadata and packaged dist files were omitted.
Imported test machine paths and incident session/project IDs were replaced with
synthetic equivalents. No user runtime configuration was imported.
The SSH Upload 0.3.0 candidate retains the approved compact UI and adds shared
server connections with project-specific folders for new SSH workspace projects.
Its versioned settings preserve old per-context records. Legacy remote histories
keep their old matching rules, and permissions/SSH authentication are unchanged.
No deployment or package publication is implied.
