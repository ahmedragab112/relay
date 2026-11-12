---
name: PostgreSQL
description: Correct schemas and queries
category: Backend & data
order: 8
---

Let the database enforce what must always be true.

- Use constraints for uniqueness, foreign keys, and nullability.
- Index the columns used in filters and joins; verify with EXPLAIN.
- Keep transactions short and ordered consistently.
- Use timestamptz and store UTC.
- Test queries against realistic data volume.
