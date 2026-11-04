# UI acceptance

- U1: configured server/project opens with resolved saved values, not blank re-entry.
- U2: server-wide connection/project-only directory scope is explained.
- U3: changed binding resets stale fields and old results cannot be inserted.
- U4: storage errors remain visible; compact status/configure/resume/cancel behavior remains functional.

No new visual design; no native installed-app acceptance implied.

## Sign-off

U1 is covered at real backend Save/Context interfaces with private temporary
file-backed SDK fixtures and independent cold processes. U2/U3/U4 pass actual
renderer/dialog/status browser workflows with fixture host RPC: scope guidance,
stale-binding form reset, configuration-changed result deferral, cancel/resume,
compact A indicators and session safety. Browser fixtures do not prove native
installed-plugin restart, actual host themes or screen-reader announcements.
No user app or real SSH endpoint was used; deployment remains separate.
