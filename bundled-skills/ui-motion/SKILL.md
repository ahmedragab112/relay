---
name: UI motion
description: Motion that explains change
category: Frontend
order: 9
---

Animate state changes, not decoration.

- Use short durations: roughly 120 to 260 ms for most UI changes.
- Prefer transform and opacity over layout properties.
- Animate entrance, dismissal, and reordering; let the rest stay still.
- Respect prefers-reduced-motion.
- Cancel or settle animations when a newer state arrives.
