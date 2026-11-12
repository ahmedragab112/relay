---
name: Systematic debugging
description: Find the root cause before changing code
category: Engineering
order: 9
---

Treat every bug as a question about where reality diverges from expectation.

- Reproduce the failure first and write down the exact steps.
- Read the full error and stack trace before forming a theory.
- Trace the bad value back to its origin; fix at the source, not the symptom.
- Change one variable at a time and state the hypothesis you are testing.
- If three fixes fail, stop and question the design instead of adding a fourth.
