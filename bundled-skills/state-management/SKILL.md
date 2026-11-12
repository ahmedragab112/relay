---
name: State management
description: Choose the smallest state model that works
category: Frontend
order: 7
---

Separate server state, URL state, and local UI state.

- Keep state close to where it is used.
- Normalize collections by id when several views share them.
- Derive what you can; store only the source of truth.
- Avoid global state for values one view owns.
- Make updates immutable and traceable.
