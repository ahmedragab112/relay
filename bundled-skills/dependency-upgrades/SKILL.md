---
name: Dependency upgrades
description: Upgrade dependencies without breaking the app
category: Engineering
order: 4
---

Read release notes and the migration guide, not only the version number.

- Upgrade one dependency family at a time and keep the lockfile change isolated.
- Run type checking and the full test suite after each upgrade.
- Search the code for removed or renamed APIs before bumping.
- Prefer the smallest version jump that fixes the reason for upgrading.
- Record why a dependency is pinned when it must stay behind.
