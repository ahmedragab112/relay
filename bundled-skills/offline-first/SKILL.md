---
name: Offline-first
description: Work without a connection
category: Mobile & desktop
order: 7
---

Assume the network is slow, flaky, and sometimes absent.

- Store writes locally and sync later.
- Make sync operations idempotent.
- Resolve conflicts with an explicit rule and show it to the user.
- Queue requests and retry with backoff.
- Show sync state honestly.
