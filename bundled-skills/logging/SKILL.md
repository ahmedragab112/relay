---
name: Logging
description: Log enough to reconstruct what happened
category: Engineering
order: 6
---

Log events that explain a decision or a failure, not every line executed.

- Include a stable identifier: request, session, task, or file.
- Use levels consistently: error for broken behavior, warn for degraded, info for lifecycle.
- Log structured fields instead of string-concatenating values.
- Never log credentials, personal data, or full payloads.
- Remove temporary debug logs before finishing.
