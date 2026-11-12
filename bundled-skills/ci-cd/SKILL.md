---
name: CI/CD
description: Pipelines that fail fast
category: DevOps
order: 1
---

Keep feedback fast and failures obvious.

- Run cheap checks first: lint, types, unit tests.
- Cache dependencies keyed by the lockfile.
- Make every step reproducible outside the pipeline.
- Fail on flaky tests instead of retrying silently.
- Gate deploys on tests and a reviewable artifact.
