# UI acceptance

- U1: clicking an explicit remote file reference opens its contents in the matching session panel.
- U2: image references preview safely; external files do not invoke local OS or project plugins.
- U3: old missing paths show missing-file feedback; switching sessions cannot show a late result.

Existing UI reused; no new visual design. Native running-app verification is not authorized.

## Sign-off

U1/U2/U3 passed in scripts/e2e-ssh-external-preview.mjs using real React/Chromium
and a real authenticated loopback RACP file service, not a mock of the preview
implementation. It covers both SSH paths, external text/image display, accurate
missing-file feedback, native-opening denial and a response delayed across a
session switch. Legacy return-to-list works after success and read failure.
No running user desktop or real SSH deployment was used; those remain later
packaging/deployment acceptance. Existing UI is reused except for the localized
Back to files action; no new visual design or mockup review was required.
