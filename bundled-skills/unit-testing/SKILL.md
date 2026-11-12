---
name: Unit testing
description: Focused tests that catch regressions
category: Testing & security
order: 10
---

Test behavior through the public interface.

- One behavior per test with a name that states the expectation.
- Cover the happy path, boundaries, and error cases.
- Avoid mocking what you own; test real code where practical.
- Keep tests independent and fast.
- Assert on outcomes, never on internal calls.
