---
description: Review secret handling
---

Review secret handling in the code the user describes.

1. Check nothing is committed or logged.
2. Verify secrets load from the environment at runtime.
3. Confirm least privilege per secret.
4. Look for long-lived credentials that could rotate.
