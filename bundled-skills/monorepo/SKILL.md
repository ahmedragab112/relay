---
name: Monorepo
description: Many packages, one repository
category: Workflow
order: 9
---

Keep package boundaries honest and builds incremental.

- Give each package one responsibility and an explicit public entry point.
- Avoid deep imports across packages.
- Cache builds and tests per package in CI.
- Version internal packages consistently.
- Run affected-only checks for pull requests.
