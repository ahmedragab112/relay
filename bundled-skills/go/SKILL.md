---
name: Go
description: Write simple, explicit Go
category: Languages
order: 2
---

Return errors and handle them at the call site.

- Wrap errors with context using fmt.Errorf and the %w verb.
- Keep interfaces small and define them where they are consumed.
- Pass context.Context through every call that can block.
- Avoid goroutines without a clear owner and exit path.
- Use the race detector in tests.
