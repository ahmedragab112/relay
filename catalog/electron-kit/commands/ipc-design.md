---
description: Design an IPC channel
---

Design the IPC the user describes.

1. Keep the renderer sandboxed with context isolation on.
2. Expose the smallest typed surface through preload.
3. Validate every argument in the main process.
4. Never pass raw file paths or shell strings from the renderer.
