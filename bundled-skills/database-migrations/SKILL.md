---
name: Database migrations
description: Migrations that are safe to deploy
category: Backend & data
order: 3
---

Design migrations to run while old and new code are both live.

- Make each migration backward compatible.
- Add nullable columns first, backfill, then enforce.
- Rename in steps: add, dual-write, migrate, remove.
- Keep migrations small and reversible where possible.
- Test against a copy of production data.
