---
name: API design
description: Design interfaces that are hard to misuse
category: Engineering
order: 1
---

Design from the caller's side of the boundary.

- Choose names that say what the caller controls, not how the system works.
- Make invalid states unrepresentable instead of documenting them away.
- Keep one obvious way to do each thing; avoid parallel variants.
- Return errors the caller can act on, with stable codes and plain messages.
- Version or evolve without breaking existing callers.
