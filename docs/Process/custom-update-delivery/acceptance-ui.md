# Existing UI acceptance

- U1: Settings and menu retain update checks and concise localized failure text.
- U2: a discovered custom version offers the custom release page, not upstream.
- U3: ad-hoc macOS exposes manual delivery, not restart-to-install.

No layout change. Native Mac packaging/installation is a separate environment gate.

## Sign-off

U1/U2/U3 covered at the controller/IPC contract boundary by the desktop suite
and custom-update-delivery.test.mjs, including the mocked Electron shell's exact
opened URL, localized errors, manual Mac behavior and saved settings.
No native UI click or Mac installed-build acceptance was performed. Visual review
is not applicable because no layout or control changed. Native acceptance remains
pending; see acceptance.md for the verified server evidence and limits.
