---
name: Rust
description: Ownership-first Rust
category: Languages
order: 7
---

Let the borrow checker guide the design instead of fighting it.

- Prefer borrowing over cloning; clone only with a reason.
- Model absence with Option and failure with Result.
- Avoid unwrap and expect outside tests and prototypes.
- Keep unsafe blocks small, documented, and covered by tests.
- Split modules by responsibility, not by type category.
