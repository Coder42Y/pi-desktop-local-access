# User-authored plugin source

Follow root AGENTS.md. Keep each plugin under plugins/<directory> with its
manifest, entry points and original notices. Do not copy it into bundled app
resources or activate it as part of a source change.

- Preserve existing plugin IDs, permissions, transfer and settings behavior
  unless the task explicitly changes them.
- Exclude live profiles, credentials, keys, runtime data and packaged outputs.
- Keep visible strings in the plugin's locale catalog and scope styles to its
  own prefix. Reuse host theme tokens without depending on private host modules.
- Cover UI state changes with actual component/browser tests and run the plugin's
  transfer/session/cancellation regressions. Mock only host/transport boundaries.
- Real SSH, installed user plugins and live app sessions are not default tests.
