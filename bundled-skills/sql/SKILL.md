---
name: SQL
description: Correct and efficient SQL
category: Languages
order: 8
---

State the question in plain language, then write the query that answers it.

- Read the execution plan before tuning.
- Filter early and select only needed columns.
- Verify join cardinality so rows are not duplicated or dropped.
- Use parameters, never string concatenation, for values.
- Check null behavior in filters and aggregates.
