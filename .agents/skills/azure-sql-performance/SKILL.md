---
name: azure-sql-performance
description: Shape SQL Server persistence and queries for safe, observable marketplace traffic.
---

- Inspect generated SQL and indexes for hot paths such as catalog, worker search, and bookings.
- Persist UTC values and use explicit decimal precision; keep PII out of public projections and logs.
- Use SQL Server integration tests for provider-specific behavior and transactions.
- Measure before adding indexes or caching; avoid per-row database calls.
- Keep runtime identity permissions narrow and use managed identity in Azure.
