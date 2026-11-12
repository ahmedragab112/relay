---
name: CSS architecture
description: Layered, predictable styles
category: Frontend
order: 2
---

Name styles by role, not by page or color.

- Define tokens for color, spacing, radius, and type; use them everywhere.
- Keep specificity flat; avoid nested selectors that mirror the DOM.
- Scope layout to the parent and let components size themselves.
- Avoid !important except for user-preference overrides.
- Delete unused selectors instead of keeping them for later.
