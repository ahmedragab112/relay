---
name: Error handling
description: Handle failures at the boundary, not everywhere
category: Engineering
order: 5
---

Handle errors where you can actually do something about them.

- Validate input at system boundaries: user input, network data, files.
- Let internal errors propagate to a single handler instead of catching and swallowing.
- Preserve the original error message and cause when wrapping.
- Never log a secret, token, or full request body.
- Make failure visible to the user in plain language with a next step.
