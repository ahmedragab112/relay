---
name: LLM evals
description: Measure model behavior on purpose
category: Data & AI
order: 4
---

Write the eval before changing the prompt.

- Build a small set of real inputs with expected properties.
- Score with deterministic checks where possible.
- Use pairwise comparison for subjective quality.
- Track regressions per change, not only the average.
- Keep a held-out set you do not tune against.
