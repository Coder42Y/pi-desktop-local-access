# 0.21.0-local.4

- Quote selected model-reply text in the composer. Keep the current question, remove excerpts individually, and send the question and quotes together.
- Open extensionless local paths, dotfiles and uncommon filename extensions from chat. Browse linked project directories and directory aliases in File Manager. Explicit absolute links resolve to their exact target.
- Preview project-external local images on click, with owner-scoped SSH text/image previews and Finder actions available through their existing routes.
- Let the local Agent list, wait for and stop its background Bash commands, including retrieving exit status and bounded output. Launch still requires conversation/Host consent in Auto mode and respects delegated authorization ceilings.
- Fix quote-state server rendering for home and remote composers.

## Packages and compatibility

Five primary Desktop installers are provided for macOS arm64/x64, Windows x64 and Linux arm64/x64. Two matching Linux pi-host archives support SSH. ZIP payloads, local update feeds, the Windows blockmap and pi-host checksum sidecars are retained for runtime/update integrity.

Desktop and pi-host use the full version 0.21.0-local.4. SSH users should explicitly install/repair the Host from this matching release. Daily SSH startup does not upgrade an existing Host automatically.

The macOS packages are unsigned and not notarized. macOS update delivery uses the customized manual installation flow. Native installed-macOS Finder/update acceptance remains pending.

## Source and verification

- Source commit: [1588e6dbfe4920a239f660635f4db8aa3e4c3d9c](https://github.com/Coder42Y/pi-desktop-local-access/commit/1588e6dbfe4920a239f660635f4db8aa3e4c3d9c).
- [Native build and package provenance](https://github.com/Coder42Y/pi-desktop-local-access/actions/runs/42340436461).
- [Release-source CI](https://github.com/Coder42Y/pi-desktop-local-access/actions/runs/42340436358).
- Native packages are checked against their build provenance and SHA-256 manifests. Local updater payload sizes and SHA-512 values are checked before publication.
