---
name: Security review
description: Look for the exploitable path
category: Testing & security
order: 7
---

Think like an attacker with the access the feature grants.

- Trace user input to every sink: queries, files, shells, HTML.
- Check authorization on every object, not only the route.
- Look for secrets in logs, errors, and client bundles.
- Verify rate limits on expensive and sensitive endpoints.
- Report exploitability and severity, with a concrete fix.
