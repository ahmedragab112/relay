---
name: Linux shell
description: Safe, readable scripts
category: DevOps
order: 6
---

Write scripts that fail loudly and leave evidence.

- Start bash scripts with set -euo pipefail.
- Quote variables and check required arguments.
- Use a temporary directory and clean it up with trap.
- Prefer long option names in scripts for readability.
- Test destructive commands with a dry run first.
