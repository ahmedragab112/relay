---
name: Model fine-tuning
description: Fine-tune only after prompting fails
category: Data & AI
order: 6
---

Prove the baseline first, then improve it.

- Collect examples that match the real distribution.
- Clean and deduplicate before training.
- Hold out a validation set from the same distribution.
- Compare against the best prompted baseline.
- Record data, hyperparameters, and eval results together.
