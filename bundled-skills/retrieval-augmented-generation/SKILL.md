---
name: Retrieval-augmented generation
description: Ground answers in retrieved sources
category: Data & AI
order: 10
---

Retrieval is a precision problem before it is a prompting problem.

- Chunk documents by meaning and keep headings with content.
- Embed and retrieve with the same model family.
- Rerank before filling the context window.
- Require citations and refuse when sources do not support the answer.
- Evaluate retrieval recall separately from answer quality.
