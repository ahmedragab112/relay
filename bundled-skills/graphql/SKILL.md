---
name: GraphQL
description: Schemas and resolvers that scale
category: Backend & data
order: 4
---

Design the schema around client use cases, not the database tables.

- Keep nullability honest.
- Batch and cache data loading per request to avoid N+1 queries.
- Limit query depth and cost.
- Resolve permissions at the field boundary.
- Deprecate fields before removing them.
