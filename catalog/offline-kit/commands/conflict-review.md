---
description: Review conflict handling
---

Review conflict handling in the code the user describes.

1. Find every place two writers can touch one record.
2. Confirm the merge rule is deterministic.
3. Verify data is never silently dropped.
4. Test the interleavings that matter, not all of them.
