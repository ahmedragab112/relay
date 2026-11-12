---
name: Legacy modernization
description: Replace old systems safely
category: Workflow
order: 8
---

Strangle the old system behind a stable interface.

- Characterize current behavior with tests before changing it.
- Introduce a seam at the boundary you want to replace.
- Migrate one path at a time behind a flag.
- Keep data compatible during dual-run.
- Delete the legacy path only after traffic moves.
