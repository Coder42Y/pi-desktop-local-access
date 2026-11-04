# Shared SSH connection profiles

User approved server-level connection reuse and project-specific upload folders.
After clarifying the host API boundary, user explicitly selected plugin-only
implementation for new SSH workspace projects. Legacy remote conversations keep
the original matching rules. No app/Host API, permission or credential changes.
No live configuration reads, installation, push, merge or release. This new task
authorizes implementation; a separate commit request is required.
