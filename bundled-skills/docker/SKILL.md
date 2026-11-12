---
name: Docker
description: Small, reproducible images
category: DevOps
order: 2
---

Build images that run the same everywhere.

- Start from a pinned base image and update deliberately.
- Copy dependency manifests before source so layers cache.
- Run as a non-root user.
- Keep secrets out of layers and build args.
- Use a multi-stage build to ship only runtime files.
