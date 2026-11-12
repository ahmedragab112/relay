---
name: Authentication
description: Sessions and tokens done safely
category: Backend & data
order: 1
---

Never roll your own cryptography.

- Hash passwords with a modern KDF and per-user salt.
- Store session tokens hashed and expire them server-side.
- Prefer short-lived access tokens with refresh rotation.
- Set cookies HttpOnly, Secure, and SameSite.
- Rate-limit login and reset endpoints.
