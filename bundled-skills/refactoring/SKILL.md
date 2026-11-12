---
name: Refactoring
description: Improve structure without changing behavior
category: Engineering
order: 8
---

Refactor only under a green test suite, and keep behavior fixed while you work.

- Make one mechanical change at a time and rerun tests between changes.
- Prefer extracting a well-named function over adding a comment.
- Remove dead code, duplicated branches, and unused parameters as you go.
- Keep public interfaces stable unless the change explicitly targets them.
- Stop when the structure is clear; do not redesign for hypothetical futures.
