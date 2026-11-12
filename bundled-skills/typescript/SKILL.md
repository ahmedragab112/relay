---
name: TypeScript
description: Write types that carry meaning
category: Languages
order: 10
---

Model the domain, not the implementation.

- Prefer discriminated unions for states that are mutually exclusive.
- Avoid any; use unknown and narrow at the boundary.
- Let inference do the work on locals; annotate public signatures.
- Keep types next to the code that owns them.
- Run strict mode and fix the root cause of each error.
