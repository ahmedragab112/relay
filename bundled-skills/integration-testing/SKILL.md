---
name: Integration testing
description: Test real boundaries
category: Testing & security
order: 4
---

Test the seams between parts, not every line again.

- Use real databases and queues where feasible; reset state between tests.
- Cover transactions, retries, and timeouts.
- Verify error translation across boundaries.
- Keep fixtures small and named for the scenario.
- Run integration tests in CI against the same versions as production.
