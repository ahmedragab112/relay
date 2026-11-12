---
name: Performance tuning
description: Measure before optimizing anything
category: Engineering
order: 7
---

Find the real bottleneck before changing code.

- Reproduce the slow path and capture a baseline number.
- Measure with a profiler or timing around the suspected section.
- Fix the dominant cost first; do not micro-optimize cold paths.
- Re-measure after each change and keep the numbers.
- Prefer fewer round trips and smaller payloads over clever code.
