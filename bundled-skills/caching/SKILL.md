---
name: Caching
description: Cache with an invalidation story
category: Backend & data
order: 2
---

Every cache entry needs an owner and an expiry.

- Cache the expensive, read-heavy, and tolerant-of-staleness data.
- Key by everything that changes the result.
- Invalidate on write or use short TTLs.
- Protect the origin from a cold-start stampede.
- Measure hit rate; remove caches that do not help.
