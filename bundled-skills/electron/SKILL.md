---
name: Electron
description: Secure desktop apps with Electron
category: Mobile & desktop
order: 3
---

Treat the renderer as untrusted.

- Keep node integration off and context isolation on.
- Expose a narrow API through the preload bridge.
- Validate every IPC argument in the main process.
- Deny navigation and new windows by default.
- Store secrets with the platform keychain.
