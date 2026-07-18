This is the legacy Study Buddy output location.

New workspace-scoped runs belong below `study-buddy-data/`, separated by thread
for regular projects. Existing runs remain here so their recorded paths and
recovery handoffs continue to work.

```text
study-buddy-data/threads/<thread-id>/runs/<request-name>/
```

Quick Chat workspaces omit the `threads/<thread-id>/` layer. User-facing
deliverables are published outside `study-buddy-data/`; internal sources,
diagnostics, caches, and canonical workflow files stay inside it.
