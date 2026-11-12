---
name: React
description: Build React UI that stays predictable
category: Frontend
order: 6
---

Derive UI from state and keep effects for real side effects only.

- Keep components small and pass data down through explicit props.
- Use keys that identify the item, never the array index.
- Put server data in a query layer and local UI state in the component that owns it.
- Clean up subscriptions and timers in effects.
- Measure renders before memoizing anything.
