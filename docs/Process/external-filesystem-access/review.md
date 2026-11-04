# Independent review

One bounded read-only explorer review ran in the explicitly authorized worktree
using Bash, avoiding the earlier Read-tool workspace restriction. It reported one
P2: native remote session cards offered only allow-session while default AgentHost
policy removed that decision, causing INVALID_ARGUMENT even for the paired owner.

Resolution: broker retains the filesystem-scope decision; AgentHost allows it only
for paired owner or an explicitly configured grant policy. Ordinary grants stay
restricted, non-owner/unpaired callers are denied, and duplicate replies return
the same result. AgentHost and RACP regression tests failed before the fix and now
pass. No second broad review was requested or run. Reviewer did not validate a
real Mac, SSH server or user Desktop.
