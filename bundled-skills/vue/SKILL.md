---
name: Vue
description: Idiomatic Vue composition
category: Frontend
order: 10
---

Prefer the composition API with explicit inputs and outputs.

- Keep props typed and avoid mutating them.
- Use computed values for derived state instead of watchers.
- Emit events upward; do not reach into parent state.
- Scope styles to the component.
- Clean up watchers and listeners on unmount.
