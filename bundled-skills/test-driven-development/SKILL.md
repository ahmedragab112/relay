---
name: Test-driven development
description: Write the failing test before the implementation
category: Engineering
order: 10
---

Work in short red, green, refactor cycles.

- Write one failing test that names the behavior that should change.
- Run it and confirm it fails for the right reason.
- Implement the smallest change that passes, then run the whole suite.
- Refactor only while everything stays green.
- Never keep implementation code written before its test; delete it and start again.
