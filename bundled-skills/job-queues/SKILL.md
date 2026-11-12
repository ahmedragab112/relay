---
name: Job queues
description: Background work that survives failure
category: Backend & data
order: 5
---

Assume every job will fail once and run twice.

- Make handlers idempotent.
- Set timeouts and bounded retries with backoff.
- Move permanently failed jobs to a dead-letter queue.
- Keep jobs small; split long workflows into steps.
- Log job id, attempt, and outcome.
