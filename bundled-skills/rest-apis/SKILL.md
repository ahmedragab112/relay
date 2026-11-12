---
name: REST APIs
description: Predictable HTTP APIs
category: Backend & data
order: 10
---

Design resources and status codes callers can rely on.

- Use nouns for resources and HTTP verbs for actions.
- Return 400 for bad input, 401 for missing auth, 403 for denied, 404 for missing, 409 for conflict.
- Paginate collections and document the cursor.
- Make writes idempotent where clients might retry.
- Version breaking changes.
