---
name: secure-development
description: Apply privacy, authentication, and secret-handling requirements to marketplace changes.
---

- Protect cookie-authenticated writes with CSRF and enforce roles, ownership, and rate limits on the server.
- Never expose emails, private addresses, credentials, tokens, or verification evidence through public responses/logs.
- Do not commit secrets or add production demo credentials. Use environment settings, Key Vault, or managed identity.
- Validate uploads and user input; keep reset-password unavailable until a real mail sender is configured.
- Treat payment as simulated unless an explicitly approved licensed provider is integrated; never collect card data.
