---
description: Design reconnection
---

Design reconnection for the client the user describes.

1. Use exponential backoff with jitter.
2. Resume from the last acknowledged sequence.
3. Handle missed messages and duplicate delivery.
