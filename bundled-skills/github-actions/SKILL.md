---
name: GitHub Actions
description: Reliable workflow files
category: DevOps
order: 3
---

Treat workflows as code with the same care as application code.

- Pin third-party actions to a commit SHA.
- Restrict permissions to the minimum the job needs.
- Use environments and required reviewers for deploys.
- Cache and matrix deliberately; do not multiply jobs without reason.
- Keep secrets in repository or environment secrets, never in workflow files.
