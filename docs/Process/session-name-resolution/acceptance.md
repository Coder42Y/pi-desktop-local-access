# Session-name acceptance

- N-01: Rename B via existing sidebar RPC; active A resolves/reads/sends using the
  current title without reopening A or creating a new session.
- N-02: ID/history/queued messages/callback relationships stay unchanged on rename.
- N-03: Duplicate title returns bounded candidates; no arbitrary send occurs.
- N-04: Missing/former title never triggers creation or silent fuzzy matching.
- N-05: Workspace/deletion/temporary boundaries remain intact; current full names
  can be found even outside the default recent-session listing.

## Sign-off
| Criterion | Evidence | Result |
|---|---|---|
| N-01 | Public session.rename RPC while A remains active; named list/read/send; real Host E2E | Pass |
| N-02 | Same-ID read after rename; queued delivery remains pinned; subscribed callback source/target/reply IDs | Pass |
| N-03 | Structured CONFLICT with candidates; zero ledger inserts on ambiguous send; current/Plan duplicates | Pass |
| N-04 | Old/missing name NOT_FOUND; session counts unchanged; no fuzzy matching or auto-spawn | Pass |
| N-05 | Exact Unicode 80-character title, beyond-100-row lookup, foreign/deleted boundaries and legacy ID calls | Pass |
