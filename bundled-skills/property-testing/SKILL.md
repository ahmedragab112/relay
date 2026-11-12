---
name: Property testing
description: Find edge cases with generated input
category: Testing & security
order: 6
---

State the invariant, then let generated inputs try to break it.

- Start with small sizes and a fixed seed for reproducibility.
- Shrink failures to the smallest counterexample.
- Cover parsers, encoders, and state machines.
- Keep properties independent of the implementation.
- Turn every found bug into a regression example.
