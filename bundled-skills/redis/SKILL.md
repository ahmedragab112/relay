---
name: Redis
description: Caching and fast state with Redis
category: Backend & data
order: 9
---

Decide up front what happens when the key is missing.

- Set TTLs on every cache entry.
- Namespace keys and version them when formats change.
- Prefer atomic operations over read-then-write.
- Treat Redis as ephemeral unless persistence is configured and tested.
- Watch memory and eviction policy in production.
