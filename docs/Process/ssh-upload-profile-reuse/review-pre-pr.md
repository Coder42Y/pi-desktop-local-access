# Single read-only review and remediation

The reviewer found one P2 race: Save checked upload activity before awaited
metadata, so a new paste could start before the eventual settings write.

Remediation: instance-owned mutual exclusion for save/select/start/paste
admission, plus repeated activity checks after metadata and immediately before
SDK persistence. Capture the owning controller; disposed stores cannot mutate
new instance state. Three gated concurrency regressions cover both operation
orders and the initial metadata window. The exact metadata-window regression
failed with the expected missing rejection on an isolated pre-gate main snapshot;
the current candidate then passed it and the full plugin suite.

No second broad review was performed. The reviewer reported no other concrete
finding. Known SDK outer-file corruption fallback/non-atomic writes, native
installed-plugin restart and real SSH remain outside selected plugin-only scope.
