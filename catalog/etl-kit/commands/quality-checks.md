---
description: Add data quality checks
---

Add quality checks to the pipeline the user describes.

1. Check row counts and freshness on every run.
2. Assert uniqueness, non-null keys, and value ranges.
3. Fail loudly before bad data reaches consumers.
4. Alert with the failing check and a sample row.
