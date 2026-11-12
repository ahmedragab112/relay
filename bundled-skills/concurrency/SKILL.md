---
name: Concurrency
description: Share state safely and predictably
category: Engineering
order: 3
---

Name the shared state and who can mutate it before writing concurrent code.

- Prefer message passing or immutable snapshots over shared mutable state.
- Put every async operation behind a defined cancellation and timeout path.
- Guard read-modify-write sequences with the narrowest lock that works.
- Make retries idempotent and cap them.
- Test the interleavings that matter: double submit, cancellation, and slow consumers.
