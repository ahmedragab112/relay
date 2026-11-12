---
name: Secrets management
description: Keep credentials out of code and logs
category: DevOps
order: 9
---

Assume any committed secret is already leaked.

- Load secrets from the platform or a secret manager at runtime.
- Scope secrets per service and rotate them regularly.
- Never print secrets; redact them in logs and error output.
- Prefer workload identity over long-lived keys.
- Revoke and rotate immediately when exposure is suspected.
