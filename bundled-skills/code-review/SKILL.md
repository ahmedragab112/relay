---
name: Code review
description: Review a change for correctness, security, and missing tests
category: Engineering
order: 2
---

Read the diff first, then the surrounding code before judging anything.

- Report correctness and security problems before style.
- Verify a suspected bug is reachable in the current code before reporting it.
- Name the file, function, and failure mode for every finding, with a concrete fix.
- Call out missing tests and behavior changes that are easy to regress.
- Say plainly when nothing blocking was found; do not pad the review.
